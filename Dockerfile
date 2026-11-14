FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATASENTINEL_HOST=0.0.0.0 \
    DATASENTINEL_PORT=5000

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Bundle de CA exigido pelo TLS obrigatorio do Amazon DocumentDB
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/global-bundle.pem

COPY . .

EXPOSE 5000

CMD ["python", "server.py"]
