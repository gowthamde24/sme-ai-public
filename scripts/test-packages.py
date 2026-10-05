"""Discover stdlib unittest tests in every packages/* directory, offline."""
from pathlib import Path
import socket
import subprocess
import sys
import unittest


def no_network(*args, **kwargs):
    raise RuntimeError('Package tests must not use a database or network')


def main():
    if len(sys.argv) == 1:
        root = Path(__file__).resolve().parents[1] / 'packages'
        successful = True
        for package in sorted(root.iterdir()) if root.exists() else []:
            if not package.is_dir() or package.is_symlink():
                continue
            folders = sorted({p.parent for p in package.rglob('test_*.py')
                              if not any(part in ('node_modules', '.venv', '__pycache__')
                                         for part in p.relative_to(package).parts)})
            for folder in folders:
                print(f'Package tests: {folder.relative_to(root)}', flush=True)
                result = subprocess.run([sys.executable, __file__, str(folder)])
                successful = result.returncode == 0 and successful
        return 0 if successful else 1
    socket.socket = no_network
    socket.create_connection = no_network
    socket.getaddrinfo = no_network
    suite = unittest.TestLoader().discover(sys.argv[1], pattern='test_*.py')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.dont_write_bytecode = True
    sys.exit(main())
