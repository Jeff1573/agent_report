import argparse
from urllib.parse import urlparse

import chromadb
from chromadb.api import ClientAPI

BASE_URL = "http://localhost:8000"  # 改成你的服务地址
TENANT = "default_tenant"  # 如无自定义，默认就用这个
DATABASE = "default_database"  # 同上
API_KEY = None  # 若服务器开启了鉴权，填你的密钥

_parsed = urlparse(BASE_URL)
_default_port = 443 if _parsed.scheme == "https" else 8000


def _build_client() -> ClientAPI:
    return chromadb.HttpClient(
        host=_parsed.hostname or "localhost",
        port=_parsed.port or _default_port,
        ssl=_parsed.scheme == "https",
        headers={"Authorization": f"Bearer {API_KEY}"} if API_KEY else None,
        tenant=TENANT,
        database=DATABASE,
    )


def list_collections(client: ClientAPI) -> None:
    collections = client.list_collections()
    if not collections:
        print("No collections found.")
        return
    for collection in collections:
        print(collection.name)


def delete_collection(client: ClientAPI, name: str) -> None:
    client.delete_collection(name)
    print(f"Deleted collection: {name}")


def delete_all_collections(client: ClientAPI) -> None:
    collections = client.list_collections()
    if not collections:
        print("No collections to delete.")
        return
    for collection in collections:
        client.delete_collection(collection.name)
        print(f"Deleted collection: {collection.name}")


def query_collection(client: ClientAPI, name: str, limit: int) -> None:
    """Fetch and print records from a collection to help inspect stored data."""

    # 获取目标集合：若不存在则捕获异常并给出友好提示。
    try:
        collection = client.get_collection(name)
    except Exception as err:  # pylint: disable=broad-exception-caught
        print(f"Failed to load collection '{name}': {err}")
        return

    # include 指定返回的字段；ids 默认返回，无需额外声明。
    result = collection.get(limit=limit, include=["metadatas", "documents"])

    ids = result.get("ids") or []
    documents = result.get("documents") or []
    metadatas = result.get("metadatas") or []

    if not ids:
        print(f"Collection '{name}' is empty.")
        return

    for item_id, metadata, document in zip(ids, metadatas, documents):
        print(f"ID: {item_id}")
        print(f"Metadata: {metadata}")
        print(f"Document: {document}\n")


def search_collection(client: ClientAPI, name: str, term: str, limit: int) -> None:
    """Run a semantic search inside the collection using the provided keyword."""

    try:
        collection = client.get_collection(name)
    except Exception as err:  # pylint: disable=broad-exception-caught
        print(f"Failed to load collection '{name}': {err}")
        return

    # 注意：对于使用自定义embedding函数创建的集合，不能直接使用query_texts
    # 因为这会使用ChromaDB的默认embedding函数，导致维度不匹配
    try:
        # 先尝试使用query_texts（适用于默认embedding函数的集合）
        result = collection.query(
            query_texts=[term],
            n_results=limit,
            include=["metadatas", "documents"],
        )
    except Exception as err:  # pylint: disable=broad-exception-caught
        error_msg = str(err)
        print(f"Search failed in collection '{name}': {error_msg}")
        
        if "dimension" in error_msg.lower():
            print("\n[检测到维度不匹配错误]")
            print("原因：集合使用了自定义embedding函数（如Gemini 3072维度），")
            print("     但查询时使用了ChromaDB默认embedding函数（如all-MiniLM-L6-v2 384维度）")
            print("\n[解决方案]")
            print("1. 删除集合并重新创建：python chromdb.py --delete", name)
            print("2. 或者使用与创建时相同的embedding函数进行查询")
        else:
            print("提示: 如果集合使用了自定义嵌入函数，需要改为传入 query_embeddings 与创建时相同维度的向量。")
        return

    ids_batches = result.get("ids") or []
    metadatas_batches = result.get("metadatas") or []
    documents_batches = result.get("documents") or []

    if not ids_batches or not ids_batches[0]:
        print(f"No matches found in collection '{name}' for '{term}'.")
        return

    ids = ids_batches[0]
    metadatas = metadatas_batches[0] if metadatas_batches else []
    documents = documents_batches[0] if documents_batches else []

    for index, item_id in enumerate(ids, start=1):
        metadata = metadatas[index - 1] if index - 1 < len(metadatas) else None
        document = documents[index - 1] if index - 1 < len(documents) else None
        print(f"Result {index}:")
        print(f"  ID: {item_id}")
        print(f"  Metadata: {metadata}")
        print(f"  Document: {document}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage Chroma collections.")
    parser.add_argument(
        "--delete",
        metavar="NAME",
        help="Delete the specified collection.",
    )
    parser.add_argument(
        "--delete-all",
        action="store_true",
        help="Delete all collections in the database.",
    )
    parser.add_argument(
        "--query",
        metavar="NAME",
        help="Display the contents of the specified collection.",
    )
    parser.add_argument(
        "--search",
        nargs=2,
        metavar=("NAME", "KEYWORD"),
        help="Semantic search inside the given collection using the keyword.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Number of records to show when using --query (default: 10).",
    )

    args = parser.parse_args()
    client = _build_client()

    if args.delete_all:
        delete_all_collections(client)
    elif args.delete:
        delete_collection(client, args.delete)
    elif args.search:
        collection_name, keyword = args.search
        search_collection(client, collection_name, keyword, args.limit)
    elif args.query:
        query_collection(client, args.query, args.limit)
    else:
        list_collections(client)


if __name__ == "__main__":
    main()