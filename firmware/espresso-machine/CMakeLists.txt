cmake_minimum_required(VERSION 3.22)

set(IDF_TARGET "esp32s3" CACHE STRING "PhilcoINO firmware target" FORCE)
if(NOT SDKCONFIG_DEFAULTS)
  set(SDKCONFIG_DEFAULTS "sdkconfig.defaults")
endif()
set(PROJECT_VER "0.5.0")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
idf_build_set_property(MINIMAL_BUILD ON)
project(philcoino_espresso)

# rbdimmerESP32 2.0.1 still names ESP-IDF's legacy `driver` component even
# though its public header includes driver/gpio.h. ESP-IDF 6 owns that header in
# esp_driver_gpio, so provide the missing upstream build dependency without
# modifying the managed component.
idf_component_get_property(rbdimmer_component rbdimmer__rbdimmerESP32 COMPONENT_LIB)
idf_component_get_property(gpio_component esp_driver_gpio COMPONENT_LIB)
target_link_libraries(${rbdimmer_component} PUBLIC ${gpio_component})

# The same upstream CMake file also exports fixed MAX_* definitions while the
# ESP-IDF public header defines them from Kconfig. Retain the Kconfig-owned
# definitions and remove only the duplicate upstream command-line definitions.
foreach(definitions_property COMPILE_DEFINITIONS INTERFACE_COMPILE_DEFINITIONS)
  get_target_property(rbdimmer_definitions ${rbdimmer_component} ${definitions_property})
  if(rbdimmer_definitions)
    list(FILTER rbdimmer_definitions EXCLUDE REGEX "^RBDIMMER_MAX_(CHANNELS|PHASES)=")
    set_property(TARGET ${rbdimmer_component} PROPERTY
      ${definitions_property} "${rbdimmer_definitions}")
  endif()
endforeach()
