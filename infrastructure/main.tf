locals {
  lambda_function_name = "${var.resource_name_prefix}-lambda"
}

resource "aws_ssm_parameter" "credentials" {
  name = "${var.resource_name_prefix}-credentials"
  type = "SecureString"
  value = jsonencode({
    APP_ID               = 0
    GITHUB_CLIENT_ID     = ""
    GITHUB_CLIENT_SECRET = ""
    PRIVATE_KEY          = ""
    WEBHOOK_SECRET       = ""
  })

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "config" {
  name  = "${var.resource_name_prefix}-config"
  type  = "SecureString"
  value = <<-EOT
    rules:
  EOT

  lifecycle {
    ignore_changes = [value]
  }
}

module "lambda_role" {
  source = "./modules/iam-role"

  name               = local.lambda_function_name
  assume_role_policy = jsonencode({ "Version" : "2012-10-17", "Statement" : [{ "Effect" : "Allow", "Principal" : { "Service" : "lambda.amazonaws.com" }, "Action" : "sts:AssumeRole" }] })
  inline_policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Effect" : "Allow",
        "Action" : [
          "ssm:GetParameter"
        ]
        "Resource" : [
          aws_ssm_parameter.config.arn,
          aws_ssm_parameter.credentials.arn
        ]
      }
    ]
  })
  policy_arns = ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]
}

resource "null_resource" "build_lambda_package" {
  triggers = {
    src_hash  = sha1(join("", [for f in fileset("${path.module}/../src", "**/*.js") : filesha1("${path.module}/../src/${f}")]))
    deps_hash = filesha1("${path.module}/../package-lock.json")
  }

  provisioner "local-exec" {
    interpreter = ["/bin/sh", "-c"]
    command     = <<-EOT
      set -e
      cd "${path.module}/.."
      rm -rf build && mkdir build
      cp -r src/* build/
      cp package.json package-lock.json build/
      cd build
      npm ci --production --ignore-scripts
      curl -sL "${var.zizmor_installation.download_url}" -o zizmor.tar.gz
      echo "${var.zizmor_installation.checksum}  zizmor.tar.gz" | sha256sum -c -
      tar -xzf zizmor.tar.gz
      chmod +x zizmor
    EOT
  }
}

data "archive_file" "lambda" {
  depends_on  = [null_resource.build_lambda_package]
  type        = "zip"
  source_dir  = "${path.module}/../build"
  output_path = "${path.module}/../build.zip"
}

resource "aws_lambda_function" "lambda" {
  function_name    = local.lambda_function_name
  role             = module.lambda_role.role.arn
  runtime          = "nodejs24.x"
  handler          = "aws-lambda.handler"
  timeout          = 600
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  environment {
    variables = {
      CONFIG_SSM_PARAMETER_ARN      = aws_ssm_parameter.config.arn
      CREDENTIALS_SSM_PARAMETER_ARN = aws_ssm_parameter.credentials.arn
    }
  }
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.lambda_function_name}"
  retention_in_days = 30
}

resource "aws_lambda_function_url" "lambda" {
  function_name      = aws_lambda_function.lambda.function_name
  authorization_type = "NONE"
}
