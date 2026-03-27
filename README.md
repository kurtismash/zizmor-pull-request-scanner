# zizmor-status-check-app

> A GitHub App built with [Probot](https://github.com/probot/probot) that A wrapper to run zizmor as status checks within a pull request.

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

## Contributing

If you have suggestions for how zizmor-status-check-app could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2026 The National Archives, UK
