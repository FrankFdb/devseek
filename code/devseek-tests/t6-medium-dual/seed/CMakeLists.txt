cmake_minimum_required(VERSION 3.16)
project(devseek_t6_medium_dual LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

file(GLOB PROJECT_SOURCES CONFIGURE_DEPENDS src/*.cpp)
add_library(deployment_runtime STATIC ${PROJECT_SOURCES})
target_include_directories(deployment_runtime PUBLIC include)
target_compile_options(deployment_runtime PRIVATE -Wall -Wextra -Wpedantic -Werror)

add_executable(public_test tests/public_test.cpp)
target_link_libraries(public_test PRIVATE deployment_runtime)
target_compile_options(public_test PRIVATE -Wall -Wextra -Wpedantic -Werror)

enable_testing()
add_test(NAME public_test COMMAND public_test)
