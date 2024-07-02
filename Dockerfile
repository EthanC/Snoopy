FROM python:3.12.4-slim-bullseye

WORKDIR /snoopy

# Install and configure Poetry
# https://github.com/python-poetry/poetry
RUN pip install poetry
RUN poetry config virtualenvs.create false

# Install dependencies
COPY pyproject.toml pyproject.toml
RUN poetry install --no-root

COPY . .

CMD [ "python", "snoo.py" ]
