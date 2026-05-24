.PHONY: up down build logs clean dev-ingestion dev-chatbot dev-dashboard

# ─── Docker ───────────────────────────────────────────────────────────────────
up:
	docker compose up --build -d

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

clean:
	docker compose down -v --remove-orphans

# ─── Local dev ────────────────────────────────────────────────────────────────
dev-ingestion:
	cd ingestion && uvicorn main:app --reload --port 8000

dev-chatbot:
	cd chatbot && npm run dev

dev-dashboard:
	cd dashboard && npm run dev

install:
	cd chatbot && npm install
	cd dashboard && npm install
	cd ingestion && pip install -r requirements.txt
