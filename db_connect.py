"""Supabase(PostgreSQL) 연결 어댑터.

기존 코드는 SQLite 문법(``?`` 값 자리, ``conn.execute(...)``, ``cur.lastrowid``)으로
작성되어 있습니다. 이 파일은 그 문법을 그대로 쓰면서도 실제로는 PostgreSQL(Supabase)에
연결되도록 "번역"해주는 역할을 합니다.

사용법 (app.py / database.py에서):
    from db_connect import get_conn
    conn = get_conn()
    conn.execute("SELECT * FROM students WHERE id = ?", (student_id,))
"""

from __future__ import annotations

import os
from typing import Any, Sequence

import psycopg2
import psycopg2.extensions


def _get_database_url() -> str:
    """DB 접속 주소를 가져온다.

    우선순위: 1) 환경변수 DATABASE_URL  2) Streamlit secrets["DATABASE_URL"]
    로컬에서는 .env 파일(DATABASE_URL=...)로, 클라우드에서는 Streamlit Secrets로 설정합니다.
    """
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    try:
        import streamlit as st  # 지연 import (테스트 환경에서 streamlit 없어도 되게)

        return st.secrets["DATABASE_URL"]
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            "DATABASE_URL을 찾을 수 없습니다. "
            ".env 파일에 DATABASE_URL=... 을 추가하거나 "
            "Streamlit Cloud의 Secrets에 등록해주세요."
        ) from exc


def _translate(query: str) -> str:
    """SQLite 스타일 ``?`` 값 자리를 PostgreSQL 스타일 ``%s``로 바꾼다."""
    return query.replace("?", "%s")


class _CompatCursor:
    """psycopg2 커서를 감싸서 sqlite3 커서처럼 동작하게 만드는 래퍼."""

    def __init__(self, raw_cursor: "psycopg2.extensions.cursor") -> None:
        self._cur = raw_cursor

    def execute(self, query: str, params: Sequence[Any] | None = None) -> "_CompatCursor":
        translated = _translate(query)
        if params is None:
            self._cur.execute(translated)
        else:
            self._cur.execute(translated, params)
        return self

    def executemany(self, query: str, seq_of_params: Sequence[Sequence[Any]]) -> "_CompatCursor":
        self._cur.executemany(_translate(query), seq_of_params)
        return self

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._cur.fetchall()

    def fetchone(self) -> tuple[Any, ...] | None:
        return self._cur.fetchone()

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    @property
    def description(self):
        return self._cur.description

    def close(self) -> None:
        self._cur.close()


class _CompatConnection:
    """psycopg2 연결을 감싸서 sqlite3 연결처럼 동작하게 만드는 래퍼."""

    def __init__(self, raw_conn: "psycopg2.extensions.connection") -> None:
        self._conn = raw_conn

    def execute(self, query: str, params: Sequence[Any] | None = None) -> _CompatCursor:
        """sqlite3.Connection.execute() 처럼, 연결에서 바로 실행 가능하게 함."""
        cur = _CompatCursor(self._conn.cursor())
        cur.execute(query, params)
        return cur

    def cursor(self) -> _CompatCursor:
        return _CompatCursor(self._conn.cursor())

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()


def get_conn() -> _CompatConnection:
    """Supabase(PostgreSQL)에 연결하고, SQLite 스타일로 쓸 수 있는 연결 객체를 반환.

    autocommit=True로 설정하는 이유:
    기존 코드에는 "ALTER TABLE ... ADD COLUMN" 실패를 try/except로 무시하는
    패턴이 많다. PostgreSQL은 한 문장이 실패하면 트랜잭션 전체가 막히는데
    (SQLite는 그렇지 않음), autocommit 모드에서는 문장 하나하나가 즉시
    독립적으로 처리되어 이 문제가 발생하지 않는다.
    """
    raw_conn = psycopg2.connect(_get_database_url())
    raw_conn.autocommit = True
    return _CompatConnection(raw_conn)
