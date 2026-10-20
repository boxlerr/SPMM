"""Consultas lentas EN PRODUCCIÓN (pg_stat_statements) y tablas que se leen enteras.
Sólo lectura: transacción READ ONLY por el 6543 (nunca SET SESSION ahí)."""
import asyncio, re, sys
from pathlib import Path
import asyncpg

ENV = next((d / ".env" for d in [Path.cwd(), *Path.cwd().parents] if (d / ".env").exists()), None)
if ENV is None:
    raise SystemExit("No encontré el .env con SUPABASE_DB_URL (correlo desde el repo).")
u = [l for l in ENV.read_text().splitlines()
     if l.startswith('SUPABASE_DB_URL')][0].split('=', 1)[1].strip().strip('"').strip("'")
u = re.sub(r'^postgresql\+\w+://', 'postgresql://', u).replace(':5432/', ':6543/')

CONSULTAS = {
 "info": "select stats_reset from pg_stat_statements_info",
 "lentas_total": """
   select calls, round(total_exec_time::numeric,0) total_ms, round(mean_exec_time::numeric,1) mean_ms,
          round(max_exec_time::numeric,0) max_ms, rows,
          left(regexp_replace(query, '\\s+', ' ', 'g'), 260) q
   from pg_stat_statements
   where dbid = (select oid from pg_database where datname = current_database())
     and query not ilike '%pg_stat_statements%'
   order by total_exec_time desc limit 30""",
 "lentas_media": """
   select calls, round(mean_exec_time::numeric,1) mean_ms, round(max_exec_time::numeric,0) max_ms, rows,
          left(regexp_replace(query, '\\s+', ' ', 'g'), 260) q
   from pg_stat_statements
   where dbid = (select oid from pg_database where datname = current_database()) and calls >= 5
     and query not ilike '%pg_stat_statements%'
   order by mean_exec_time desc limit 20""",
 "tablas": """
   select relname, n_live_tup, seq_scan, seq_tup_read, coalesce(idx_scan,0) idx_scan,
          pg_size_pretty(pg_total_relation_size(relid)) tam
   from pg_stat_user_tables order by seq_tup_read desc limit 25""",
}

async def main():
    conn = await asyncpg.connect(u, statement_cache_size=0)
    try:
        async with conn.transaction(readonly=True):
            for nombre, sql in CONSULTAS.items():
                print(f"\n=== {nombre}")
                try:
                    filas = await conn.fetch(sql)
                except Exception as e:
                    print("  (falló)", type(e).__name__, str(e)[:200]); continue
                for f in filas:
                    print("  " + " | ".join(str(v) for v in f.values()))
    finally:
        await conn.close()

asyncio.run(main())
