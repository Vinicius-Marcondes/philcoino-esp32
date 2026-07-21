cmake_minimum_required(VERSION 3.22)
project(philcoino_firmware_host_tests LANGUAGES CXX)

find_package(Threads REQUIRED)

option(PHILCOINO_ENABLE_SANITIZERS
       "Build API codec/property tests with AddressSanitizer and UBSan" OFF)

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
  ../components/control/src/prediction.cpp
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
  prediction_test
  prediction_test.cpp
  ../components/control/src/prediction.cpp
)

target_include_directories(
  prediction_test
  PRIVATE
    ../components/control/include
    ../components/firmware_config/include
)
target_compile_features(prediction_test PRIVATE cxx_std_17)
target_compile_options(prediction_test PRIVATE -Wall -Wextra -Werror)

add_test(NAME prediction_test COMMAND prediction_test)

add_executable(
  firmware_api_test
  firmware_api_test.cpp
  ../components/networking/src/api.cpp
  ../components/networking/src/api_codec.cpp
  ../components/networking/src/api_json.cpp
  ../components/networking/src/api_machine_codec.cpp
  ../components/networking/src/api_routes.cpp
  ../components/networking/src/api_workflow_codec.cpp
  ../components/networking/src/history.cpp
  ../components/control/src/control.cpp
  ../components/control/src/prediction.cpp
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

set(
  API_CODEC_SOURCES
  ../components/networking/src/api_codec.cpp
  ../components/networking/src/api_json.cpp
  ../components/networking/src/api_machine_codec.cpp
  ../components/networking/src/api_workflow_codec.cpp
  ../components/networking/src/history.cpp
  ../components/control/src/control.cpp
  ../components/control/src/prediction.cpp
  ../components/peripherals/src/peripherals.cpp
)

add_executable(
  api_codec_test
  api_codec_test.cpp
  ${API_CODEC_SOURCES}
  ../components/networking/src/api_routes.cpp
)

target_include_directories(
  api_codec_test
  PRIVATE
    ../components/networking/include
    ../components/control/include
    ../components/peripherals/include
    ../components/firmware_config/include
)
target_compile_features(api_codec_test PRIVATE cxx_std_17)
target_compile_options(api_codec_test PRIVATE -Wall -Wextra -Werror)

add_test(NAME api_codec_test COMMAND api_codec_test)

add_executable(
  api_codec_mutation_test
  api_codec_mutation_test.cpp
  ${API_CODEC_SOURCES}
)

target_include_directories(
  api_codec_mutation_test
  PRIVATE
    ../components/networking/include
    ../components/control/include
    ../components/peripherals/include
    ../components/firmware_config/include
)
target_compile_features(api_codec_mutation_test PRIVATE cxx_std_17)
target_compile_options(api_codec_mutation_test PRIVATE -Wall -Wextra -Werror)
target_compile_definitions(
  api_codec_mutation_test
  PRIVATE
    PHILCOINO_CODEC_CORPUS_PATH="${CMAKE_CURRENT_SOURCE_DIR}/api_codec_seed_corpus.txt"
)

add_test(NAME api_codec_mutation_test COMMAND api_codec_mutation_test)

if(PHILCOINO_ENABLE_SANITIZERS)
  foreach(target api_codec_test api_codec_mutation_test)
    target_compile_options(
      ${target}
      PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer
    )
    target_link_options(
      ${target}
      PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer
    )
  endforeach()
endif()
