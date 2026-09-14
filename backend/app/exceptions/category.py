class CategoryNotFoundError(Exception):
    def __init__(self, category_id: int) -> None:
        super().__init__(f"Category with ID '{category_id}' was not found.")


class CategoryAlreadyExistsError(Exception):
    def __init__(self, name: str) -> None:
        super().__init__(f"A category named '{name}' already exists.")


class InactiveCategoryError(Exception):
    def __init__(self, category_id: int) -> None:
        super().__init__(f"Category with ID '{category_id}' is inactive.")
