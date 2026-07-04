cmake_minimum_required(VERSION 3.22)
project(philcoino_firmware_host_tests LANGUAGES CXX)

enable_testing()

add_executable(
  firmware_config_test
  firmware_config_test.cpp
  ../components/firmware_config/src/config.cpp
)

target_include_directories(
  firmware_config_test
  PRIVATE ../components/firmware_config/include
)
target_compile_features(firmware_config_test PRIVATE cxx_std_17)
target_compile_options(firmware_config_test PRIVATE -Wall -Wextra -Werror)

add_test(NAME firmware_config_test COMMAND firmware_config_test)
