/** Vitest global setup: force a hermetic environment before anything loads env. */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ':memory:';
process.env.DATA_DIR = '/tmp/cmp-test';
process.env.APP_SECRET = 'unit-test-secret-please-ignore-0123456789';
process.env.MEDIAMTX_API_URL = 'http://mediamtx.test:9997';
process.env.MEDIAMTX_RTSP_URL = 'rtsp://mediamtx.test:8554';
process.env.PUBLIC_HOST = '192.168.1.50';
process.env.FFMPEG_PATH = '/usr/bin/ffmpeg';
process.env.FFPROBE_PATH = '/usr/bin/ffprobe';
process.env.FFMPEG_FONT_FILE = '/fonts/DejaVuSans.ttf';
process.env.LOG_LEVEL = 'silent';
