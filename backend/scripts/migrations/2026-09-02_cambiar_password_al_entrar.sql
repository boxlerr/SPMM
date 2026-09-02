-- Obligar a cambiar la contraseña la primera vez que entrás.
--
-- Pedido de Julián el 2/9, al dar de alta a Matías: la contraseña se la pasa alguien
-- por WhatsApp, así que hasta que la cambie está escrita en un chat. Hasta ahora nadie
-- podía cambiarla —el endpoint existía pero no había pantalla—, así que la que te
-- pasaban te quedaba para siempre.
--
-- Arranca en false para todos los que ya están: no tiene sentido molestar a quien ya
-- eligió la suya. Se pone en true al dar de alta a alguien nuevo, y se apaga sola en
-- cuanto la cambia.

ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT false;
