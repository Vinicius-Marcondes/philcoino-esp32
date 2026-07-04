cmake_minimum_required(VERSION 3.22)

set(IDF_TARGET "esp32c3" CACHE STRING "PhilcoINO firmware target" FORCE)
set(SDKCONFIG_DEFAULTS "sdkconfig.defaults")
set(PROJECT_VER "0.1.0")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
idf_build_set_property(MINIMAL_BUILD ON)
project(philcoino_espresso)
