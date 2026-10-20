"""Backend de banco para MEDIR: la app real del worktree contra los datos reales, sin poder escribir.

- URL del .env de la carpeta principal pasada al 6543 (transaction pooler: no gasta las
  15 plazas del 5432 que usa producción).
- Cada transacción arranca con SET TRANSACTION READ ONLY (nunca SET SESSION en el 6543).
  Si algo intenta escribir, Postgres lo rechaza.
- Sin token: get_current_user devuelve un admin real de la base (así la consulta del
  usuario que corre en cada pedido sigue existiendo, como en producción).
- Cuenta las consultas SQL de cada pedido y su tiempo, y las agrupa por sentencia: una
  sentencia repetida N veces en un pedido es la firma del N+1. Lo escribe en JSONL.

Uso (desde la raíz del worktree):
    BENCH_LOG=<archivo.jsonl> <venv>/bin/python bench_backend.py [puerto]
"""
import contextvars
import json
import os
import re
import sys
import time
from pathlib import Path

WORKTREE = Path.cwd()


def _env_del_repo() -> Path:
    """El .env con la URL de la base: el de la carpeta actual o el de alguna de arriba
    (un worktree en .claude/worktrees/ vive adentro de la carpeta principal)."""
    for d in [Path.cwd(), *Path.cwd().parents]:
        if (d / ".env").exists():
            return d / ".env"
    raise SystemExit("No encontré el .env con SUPABASE_DB_URL (correlo desde el repo).")


sys.path.insert(0, str(WORKTREE))
PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
LOG = os.environ.get("BENCH_LOG", str(WORKTREE / "bench.jsonl"))

env = {}
for linea in _env_del_repo().read_text().splitlines():
    if "=" in linea and not linea.strip().startswith("#"):
        k, v = linea.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
url = env.get("SUPABASE_DB_URL") or env.get("DATABASE_URL")
assert url and ":5432/" in url, "se esperaba la URL del session pooler en el .env"
os.environ["SUPABASE_DB_URL"] = url.replace(":5432/", ":6543/")
os.environ["DATABASE_URL"] = os.environ["SUPABASE_DB_URL"]
os.environ["SYNC_LOOP_ENABLED"] = "false"
os.environ["DB_POOL_SIZE"] = "3"
os.environ["DB_MAX_OVERFLOW"] = "2"
os.environ["RESEND_API_KEY"] = ""  # nada de mails

from sqlalchemy import event, text  # noqa: E402

from backend.infrastructure import db  # noqa: E402


@event.listens_for(db.engine.sync_engine, "begin")
def _solo_lectura(conn):
    conn.exec_driver_sql("SET TRANSACTION READ ONLY")


contador: contextvars.ContextVar = contextvars.ContextVar("contador", default=None)
_NUM = re.compile(r"\b\d+\b")
_PARAM = re.compile(r"\$\d+(::\w+)?")


def _normalizar(sql: str) -> str:
    s = " ".join(sql.split())
    s = _PARAM.sub("?", s)
    s = _NUM.sub("N", s)
    # IN (?, ?, ?...) de distinto largo cuentan como la misma sentencia
    s = re.sub(r"\((?:\?\s*,\s*)+\?\)", "(?…)", s)
    return s[:220]


@event.listens_for(db.engine.sync_engine, "before_cursor_execute")
def _antes(conn, cursor, statement, parameters, context, executemany):
    c = contador.get()
    if c is not None and context is not None:
        context._t_bench = time.perf_counter()


@event.listens_for(db.engine.sync_engine, "after_cursor_execute")
def _despues(conn, cursor, statement, parameters, context, executemany):
    c = contador.get()
    if c is None:
        return
    if statement.strip().upper().startswith("SET TRANSACTION"):
        return
    dt = (time.perf_counter() - getattr(context, "_t_bench", time.perf_counter())) * 1000
    c["n"] += 1
    c["ms"] += dt
    k = _normalizar(statement)
    g = c["por_sentencia"].setdefault(k, [0, 0.0])
    g[0] += 1
    g[1] += dt


from backend.core import security  # noqa: E402
from backend.presentation.main import app  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402


async def _contar(request, call_next):
    c = {"n": 0, "ms": 0.0, "por_sentencia": {}}
    tok = contador.set(c)
    t0 = time.perf_counter()
    try:
        resp = await call_next(request)
    finally:
        contador.reset(tok)
    total = (time.perf_counter() - t0) * 1000
    if request.method != "OPTIONS":
        top = sorted(c["por_sentencia"].items(), key=lambda kv: -kv[1][0])[:6]
        with open(LOG, "a") as f:
            f.write(json.dumps({
                "t": time.time(), "metodo": request.method,
                "ruta": request.url.path, "query": str(request.url.query),
                "status": resp.status_code, "consultas": c["n"],
                "ms_db": round(c["ms"], 1), "ms_total": round(total, 1),
                "repetidas": [[n, round(ms, 1), s] for s, (n, ms) in top if n > 1],
            }, ensure_ascii=False) + "\n")
    return resp


app.add_middleware(BaseHTTPMiddleware, dispatch=_contar)


@app.on_event("startup")
async def _usuario_del_banco():
    async with db.SessionLocal() as s:
        fila = (await s.execute(text(
            "select id_usuario, username from usuario where rol = 'admin' and activo "
            "order by id_usuario limit 1"))).first()
    assert fila, "no hay admin activo"
    usuario = {"sub": fila.username, "username": fila.username,
               "id_usuario": fila.id_usuario, "rol": "admin"}
    app.dependency_overrides[security.get_current_user] = lambda: usuario
    print(f"banco listo en :{PUERTO} como {fila.username} — log {LOG}", flush=True)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PUERTO, log_level="warning")
