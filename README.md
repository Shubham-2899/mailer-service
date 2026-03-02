# MMS Mailer Service

Express-based mailer service for distributed email sending. This service runs on each SMTP VPS and handles email campaign processing.

## Features

- Express TypeScript server
- MongoDB integration (shared with main backend)
- Background email sending loops
- Automatic pause/resume support
- Health check endpoints
- Docker support

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required environment variables:
- `PORT` - Server port (default: 4000)
- `MAILER_ID` - Unique identifier for this mailer/VPS
- `MAILER_AUTH_TOKEN` - Shared secret token for authentication
- `MONGO_URI` - MongoDB connection string
- `ROOT_MAIL_USER_PASSWORD` - SMTP password
- `SMTP_HOST`, `SMTP_USER` (optional if passed in request)

### 3. Build

```bash
npm run build
```

### 4. Run

Development:
```bash
npm run dev
```

Production:
```bash
npm start
```

## Docker

### Using Docker Compose (Recommended)

1. Make sure you have `.env` file configured:
```bash
cp .env.example .env
# Edit .env with your configuration
```

2. Start the service:
```bash
docker-compose up -d
```

3. View logs:
```bash
docker-compose logs -f
```

4. Stop the service:
```bash
docker-compose down
```

5. Rebuild after code changes:
```bash
docker-compose up -d --build
```

### Using Docker Directly

Build Image:
```bash
docker build -t mms-mailer-service .
```

Run Container:
```bash
docker run -d \
  --name mailer-service \
  -p 4000:4000 \
  --env-file .env \
  mms-mailer-service
```

### Docker Commands

Check container status:
```bash
docker ps | grep mailer-service
```

View logs:
```bash
docker logs -f mms-mailer-service
```

Stop container:
```bash
docker stop mms-mailer-service
```

Remove container:
```bash
docker rm mms-mailer-service
```

### Production Deployment

For production deployment on a VPS:

1. Clone the repository or copy the mailer-service folder
2. Configure `.env` with production values
3. Run with Docker Compose:
```bash
docker-compose up -d
```

4. Verify the service is running:
```bash
curl http://localhost:4000/mail/health
```

5. Configure firewall to allow only main backend IP:
```bash
# Example using ufw
sudo ufw allow from <BACKEND_IP> to any port 4000
```

## API Endpoints

### POST /mail/campaign/start

Start or resume a campaign.

**Headers:**
- `X-Mailer-Token`: Authentication token

**Request Body:**
```json
{
  "campaignId": "campaign-123",
  "batchSize": 50,
  "delay": 10,
  "from": "sender@example.com",
  "fromName": "Sender Name",
  "subject": "Campaign Subject",
  "emailTemplate": "<h1>Hello</h1>",
  "offerId": "offer123",
  "selectedIp": "example.com-192.168.0.1",
  "smtpConfig": {
    "host": "mail.example.com",
    "user": "admin@example.com",
    "port": 587
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Campaign campaign-123 sending started"
}
```

### POST /mail/test

Send test emails to specified recipients.

**Headers:**
- `X-Mailer-Token`: Authentication token

**Request Body:**
```json
{
  "from": "sender@example.com",
  "fromName": "Sender Name",
  "subject": "Test Email Subject",
  "emailTemplate": "<h1>Test Email</h1>",
  "offerId": "offer123",
  "campaignId": "campaign-123",
  "to": ["test1@example.com", "test2@example.com"],
  "selectedIp": "example.com-192.168.0.1",
  "smtpConfig": {
    "host": "mail.example.com",
    "user": "admin@example.com",
    "port": 587
  }
}
```

**Response:**
```json
{
  "message": "All emails sent successfully",
  "success": true,
  "sent": ["test1@example.com", "test2@example.com"],
  "failed": [],
  "emailSent": 2,
  "emailFailed": 0
}
```

### GET /mail/health

Health check endpoint (no authentication required).

**Response:**
```json
{
  "status": "ok",
  "mailerId": "vps-1",
  "activeCampaigns": ["campaign-123"],
  "timestamp": "2024-01-01T10:00:00.000Z"
}
```

### GET /mail/queue

Get queue status (requires authentication).

**Headers:**
- `X-Mailer-Token`: Authentication token

**Response:**
```json
{
  "success": true,
  "runningCampaigns": 1,
  "campaignIds": ["campaign-123"]
}
```

## How It Works

1. Main backend calls `POST /mail/campaign/start` with campaign details
2. Mailer service starts a background loop for that campaign
3. Loop checks campaign status in MongoDB before each batch
4. Fetches pending recipients and sends emails
5. Updates MongoDB with results
6. Exits when campaign is paused or completed

## Pause/Resume

- **Pause**: Main backend sets `campaign.status = 'paused'` in MongoDB. Mailer loop checks status and exits gracefully.
- **Resume**: Main backend sets `campaign.status = 'running'` and calls `POST /mail/campaign/start` again. Mailer starts new loop and continues from remaining pending emails.

## Security

- All endpoints (except `/health`) require `X-Mailer-Token` header
- Token should match `MAILER_AUTH_TOKEN` environment variable
- Network-level restrictions: Only allow connections from main backend IPs

## Monitoring

- Health check: `GET /mail/health`
- Queue status: `GET /mail/queue`
- Logs: Check console output for campaign progress
