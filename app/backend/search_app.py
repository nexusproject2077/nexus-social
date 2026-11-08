from server import app
from routers.entity_search import router

app.include_router(router)
