import argparse
import getpass
import sys

from pydantic import ValidationError

from app.core.security import password_hasher
from app.database.session import SessionLocal
from app.exceptions.user import (
    InitialAdminAlreadyExistsError,
    UserAlreadyExistsError,
)
from app.repositories.user import UserRepository
from app.schemas.user import InitialAdminCreate
from app.services.user import UserService


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create PulseDesk's first administrator.",
    )
    parser.add_argument("--email", required=True)
    parser.add_argument("--first-name", required=True)
    parser.add_argument("--last-name", required=True)
    return parser.parse_args()


def prompt_for_password() -> str:
    password = getpass.getpass("Password: ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        raise ValueError("Passwords do not match.")
    return password


def run() -> int:
    arguments = parse_arguments()

    try:
        data = InitialAdminCreate(
            email=arguments.email,
            password=prompt_for_password(),
            first_name=arguments.first_name,
            last_name=arguments.last_name,
        )
    except (ValidationError, ValueError) as error:
        print(f"Invalid bootstrap data: {error}", file=sys.stderr)
        return 1

    with SessionLocal() as db:
        service = UserService(
            db=db,
            user_repository=UserRepository(db),
            password_hasher=password_hasher,
        )
        try:
            admin = service.bootstrap_initial_admin(data)
        except InitialAdminAlreadyExistsError:
            print("Bootstrap refused: an administrator already exists.", file=sys.stderr)
            return 1
        except UserAlreadyExistsError:
            print("Bootstrap refused: that email is already in use.", file=sys.stderr)
            return 1

    print(f"Created initial administrator {admin.email} (ID: {admin.id}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
