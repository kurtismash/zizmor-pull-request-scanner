variable "resource_name_prefix" {
  type    = string
  default = "zizmor-pull-request-scanner"
}

variable "zizmor_installation" {
  type = object({
    checksum     = string
    download_url = string
  })
  default = {
    checksum     = "67a8df0a14352dd81882e14876653d097b99b0f4f6b6fe798edc0320cff27aff"
    download_url = "https://github.com/zizmorcore/zizmor/releases/download/v1.23.1/zizmor-x86_64-unknown-linux-gnu.tar.gz"
  }
}
