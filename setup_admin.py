#!/usr/bin/env python3
"""
Herramienta para configurar o cambiar las credenciales del administrador.
Uso: python3 setup_admin.py
"""
import getpass
import hashlib
import os
import secrets

ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')


def setup():
    print()
    print('=== Configuración de Admin — CSV Traductor ===')
    print()
    email = input('Email del admin: ').strip()
    if not email:
        print('Error: el email no puede estar vacío.')
        return

    password = getpass.getpass('Contraseña (mín. 8 caracteres): ')
    if len(password) < 8:
        print('Error: la contraseña debe tener al menos 8 caracteres.')
        return

    confirm = getpass.getpass('Confirmar contraseña: ')
    if password != confirm:
        print('Error: las contraseñas no coinciden.')
        return

    salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000).hex()

    with open(ENV_PATH, 'w') as f:
        f.write(f'ADMIN_EMAIL={email}\n')
        f.write(f'ADMIN_PASSWORD_HASH={hashed}\n')
        f.write(f'ADMIN_SALT={salt}\n')

    print()
    print(f'Credenciales guardadas en: {ENV_PATH}')
    print('IMPORTANTE: No subas .env a git ni lo compartas.')
    print()


if __name__ == '__main__':
    setup()
