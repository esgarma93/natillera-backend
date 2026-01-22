# Natillera Backend

NestJS backend for the Natillera savings group management application.

## Features

- **Partners Module**: CRUD operations for managing group members
- **Payments Module**: Track monthly payments with verification workflow
- **WhatsApp Integration**: Receive payment vouchers via WhatsApp Business API
- **OCR Processing**: Automatic payment amount extraction using Google Cloud Vision

## Project Structure

```
/natillera-backend
├── src
│   ├── partners/          # Partners module (clean architecture)
│   ├── payments/          # Payments module (clean architecture)
│   ├── whatsapp/          # WhatsApp webhook & OCR services
│   ├── database/          # MongoDB configuration
│   ├── app.module.ts
│   └── main.ts
├── package.json
├── tsconfig.json
└── .env
```

## Environment Variables

Create a `.env` file with the following variables:

```env
# Server
PORT=3001

# MongoDB
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/natillera

# WhatsApp Business API
WHATSAPP_VERIFY_TOKEN=your_webhook_verify_token
WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id

# Google Cloud Vision (for OCR)
# Option 1: JSON credentials string (for cloud deployment)
GOOGLE_CLOUD_CREDENTIALS={"type":"service_account","project_id":"..."}

# Option 2: Path to credentials file (for local development)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

## Google Cloud Vision Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Cloud Vision API
4. Create a Service Account:
   - Go to IAM & Admin > Service Accounts
   - Create a new service account
   - Grant "Cloud Vision API User" role
   - Create and download JSON key
5. For local development:
   - Save the JSON file and set `GOOGLE_APPLICATION_CREDENTIALS` to its path
6. For Railway deployment:
   - Copy the entire JSON content
   - Set `GOOGLE_CLOUD_CREDENTIALS` environment variable with the JSON string

## WhatsApp Business API Setup

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create or select an app
3. Add WhatsApp product
4. Configure webhook URL: `https://your-domain.com/whatsapp/webhook`
5. Subscribe to messages webhook
6. Get your access token and phone number ID

## Installation

```bash
npm install
```

## Running the app

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## API Endpoints

### Partners
- `GET /partners` - List all partners
- `GET /partners/:id` - Get partner by ID
- `POST /partners` - Create partner
- `PUT /partners/:id` - Update partner
- `DELETE /partners/:id` - Delete partner

### Payments
- `GET /payments` - List all payments
- `GET /payments/:id` - Get payment by ID
- `GET /payments/partner/:partnerId` - Get payments by partner
- `POST /payments` - Create payment
- `PUT /payments/:id` - Update payment
- `PUT /payments/:id/verify` - Verify payment
- `PUT /payments/:id/reject` - Reject payment
- `DELETE /payments/:id` - Delete payment

### WhatsApp Webhook
- `GET /whatsapp/webhook` - Webhook verification (Meta)
- `POST /whatsapp/webhook` - Receive messages