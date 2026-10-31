FROM python:3.12-slim
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
WORKDIR /app
COPY relay.py .
EXPOSE 8080
CMD ["python", "-B", "-u", "relay.py"]
