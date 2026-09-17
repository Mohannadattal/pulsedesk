from fastapi import APIRouter

from app.api.v1.endpoints import admin, auth, categories, customers, tickets, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(admin.router)
api_router.include_router(users.router)
api_router.include_router(categories.router)
api_router.include_router(customers.router)
api_router.include_router(tickets.router)
