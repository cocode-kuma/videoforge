FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv blender ffmpeg chromium fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/python && /opt/python/bin/pip install --no-cache-dir Pillow numpy soundfile
ENV PATH="/opt/python/bin:${PATH}"
ENV PRODUCER_HEADLESS_SHELL_PATH=/usr/bin/chromium
WORKDIR /work
# The host binds only one creative workspace and disables networking when running generated scripts.
CMD ["node", "--version"]
