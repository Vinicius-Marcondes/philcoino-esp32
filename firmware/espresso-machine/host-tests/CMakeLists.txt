cmake_minimum_required(VERSION 3.22)
project(philcoino_firmware_host_tests LANGUAGES CXX)

find_package(Threads REQUIRED)

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

add_executable(
  peripherals_test
  peripherals_test.cpp
  ../components/peripherals/src/peripherals.cpp
)

target_include_directories(
  peripherals_test
  PRIVATE
    ../components/peripherals/include
    ../components/firmware_config/include
)
target_compile_features(peripherals_test PRIVATE cxx_std_17)
target_compile_options(peripherals_test PRIVATE -Wall -Wextra -Werror)
target_link_libraries(peripherals_test PRIVATE Threads::Threads)

add_test(NAME peripherals_test COMMAND peripherals_test)

add_executable(
  control_test
  control_test.cpp
  ../components/control/src/control.cpp
  ../components/peripherals/src/peripherals.cpp
)

target_include_directories(
  control_test
  PRIVATE
    ../components/control/include
    ../components/peripherals/include
    ../components/firmware_config/include
)
target_compile_features(control_test PRIVATE cxx_std_17)
target_compile_options(control_test PRIVATE -Wall -Wextra -Werror)

add_test(NAME control_test COMMAND control_test)

add_executable(
  firmware_api_test
  firmware_api_test.cpp
  ../components/networking/src/api.cpp
  ../components/control/src/control.cpp
  ../components/peripherals/src/peripherals.cpp
)

target_include_directories(
  firmware_api_test
  PRIVATE
    ../components/networking/include
    ../components/control/include
    ../components/peripherals/include
    ../components/firmware_config/include
)
target_compile_features(firmware_api_test PRIVATE cxx_std_17)
target_compile_options(firmware_api_test PRIVATE -Wall -Wextra -Werror)

add_test(NAME firmware_api_test COMMAND firmware_api_test)
