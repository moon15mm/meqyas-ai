from fastapi import APIRouter

from . import (
    admin,
    ai,
    analytics,
    auth,
    cx,
    gifts,
    intelligence,
    library,
    organizations,
    plans,
    projects,
    public,
    reports,
    responses,
    stores,
    surveys,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(organizations.router)
api_router.include_router(projects.router)
api_router.include_router(plans.router)
api_router.include_router(ai.router)
# Specific survey routes (e.g. /surveys/{id}/copies) before the generic /surveys/{id}/{action}.
api_router.include_router(library.router)
api_router.include_router(surveys.router)
api_router.include_router(responses.router)
api_router.include_router(public.router)
api_router.include_router(analytics.router)
api_router.include_router(stores.router)
api_router.include_router(intelligence.router)
api_router.include_router(reports.router)
api_router.include_router(cx.router)
api_router.include_router(gifts.router)
api_router.include_router(admin.router)
