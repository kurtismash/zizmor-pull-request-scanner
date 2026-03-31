locals {
  lambda_function_name = "${var.resource_name_prefix}-lambda"
  build_zip_name       = "${path.module}/build.zip"
  source_code_fixity = sha256(join(",", flatten([
    [for f in fileset("${path.module}/../src", "**") : filesha256("${path.module}/../src/${f}")],
    filesha256("${path.module}/../package-lock.json"),
    jsonencode(var.zizmor_installation)
  ])))
}

resource "aws_ssm_parameter" "credentials" {
  name = "${var.resource_name_prefix}-credentials"
  type = "SecureString"
  value = jsonencode({
    APP_ID         = 0
    PRIVATE_KEY    = ""
    WEBHOOK_SECRET = ""
  })

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "config" {
  name  = "${var.resource_name_prefix}-config"
  type  = "SecureString"
  value = var.zizmor_config != "" ? var.zizmor_config : "rules:\n"
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

resource "terraform_data" "build_lambda_package" {
  triggers_replace = [
    local.source_code_fixity
  ]

  provisioner "local-exec" {
    interpreter = ["/bin/sh", "-c"]
    command     = "cd ${path.module}/.. && npm run build -- lambda ${var.zizmor_installation.download_url} ${var.zizmor_installation.checksum} && zip -r 'build.zip' 'build/'"
  }
}

resource "aws_lambda_function" "lambda" {
  filename         = "../build.zip"
  function_name    = local.lambda_function_name
  handler          = "aws-lambda.handler"
  memory_size      = var.lambda_config.memory_size
  role             = module.lambda_role.role.arn
  runtime          = "nodejs24.x"
  source_code_hash = local.source_code_fixity
  timeout          = var.lambda_config.timeout

  environment {
    variables = merge(
      {
        CREDENTIALS_SSM_PARAMETER_ARN = aws_ssm_parameter.credentials.arn
      },
      var.zizmor_config != "" ? {
        CONFIG_SSM_PARAMETER_ARN = aws_ssm_parameter.config.arn
      } : {}
    )
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
