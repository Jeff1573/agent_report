import chromadb
from urllib.parse import urlparse
from chromadb.config import Settings

BASE_URL = "http://localhost:8000"  # 改成你的服务地址
TENANT = "default_tenant"  # 如无自定义，默认就用这个
DATABASE = "default_database"  # 同上
API_KEY = None  # 若服务器开启了鉴权，填你的密钥

_parsed = urlparse(BASE_URL)
_default_port = 443 if _parsed.scheme == "https" else 8000

client = chromadb.HttpClient(
    host=_parsed.hostname or "localhost",
    port=_parsed.port or _default_port,
    ssl=_parsed.scheme == "https",
    headers={"Authorization": f"Bearer {API_KEY}"} if API_KEY else None,
    tenant=TENANT,
    database=DATABASE,
)

collections = client.list_collections()
for c in collections:
    print(c.name)