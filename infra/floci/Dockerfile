# EN: tiny image that has Python + boto3 so init.py / spike.py run without installing anything on your PC.
# Franco: image so8ayyara feeha Python + boto3 3ashan init.py / spike.py yeshtaghalo men gheir install 3ala gehazak.
# The scripts themselves are mounted from ./infra/floci (see docker-compose.tools.yml), so no rebuild is needed when they change.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /work/floci
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
