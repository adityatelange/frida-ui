import io
from os import path

from setuptools import setup, find_packages

pwd = path.abspath(path.dirname(__file__))
with io.open(path.join(pwd, "README.md"), encoding="utf-8") as readme:
    desc = readme.read()

setup(
    name="frida-ui",
    version=__import__("frida_ui").__version__,
    description="Interact with Frida devices, processes, and scripts directly from your browser.",
    long_description=desc,
    long_description_content_type="text/markdown",
    author="adityatelange",
    license="MIT",
    url="https://github.com/adityatelange/frida-ui",
    download_url="https://github.com/adityatelange/frida-ui/archive/v%s.zip"
    % __import__("frida_ui").__version__,
    packages=find_packages(),
    include_package_data=True,
    package_data={
        "frida_ui": ["static/*"],
    },
    install_requires=[
        "fastapi",
        "uvicorn",
        "frida",
        "pydantic",
    ],
    entry_points={
        "console_scripts": [
            "frida-ui=frida_ui.server:main",
        ],
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.7",
)
