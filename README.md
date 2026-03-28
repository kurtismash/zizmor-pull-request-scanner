# zizmor-pull-request-scanner

Run zizmor as a GitHub App to scan diffs within Pull Requests.

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t zizmor-status-check-app .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> zizmor-status-check-app
```
