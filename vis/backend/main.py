import uvicorn

from .api.routes import create_app
from .config import settings


app = create_app()


def main() -> None:
    uvicorn.run(app, host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
