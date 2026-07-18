"""Toss-style app shell: fixed nav, card layout, custom buttons (no st.sidebar)."""

from __future__ import annotations

import html as html_module
from contextlib import contextmanager
from typing import Iterator

import streamlit as st

# (slug, icon, label, internal page key)
FERMA_MENU: list[tuple[str, str, str, str]] = [
    ("dash", "", "대시보드", "대시보드"),
    ("class", "", "내 수업 관리", "내 수업 관리"),
    ("students", "", "학생 명부", "학생 명부"),
    ("attend", "", "출석 관리", "출석 관리"),
    ("attend_sheet", "", "출석부 만들기", "출석부 만들기"),
    ("tuition", "", "수강료 관리", "수강료 관리"),
    ("consult", "", "상담 일지", "상담 일지"),
    ("exams", "", "성적 리포트", "성적 리포트"),
    ("pastexam", "", "기출문제분석", "기출문제분석"),
    ("qbank", "", "문제 은행", "문제 은행"),
    ("settings", "", "설정", "설정"),
]

SLUG_TO_PAGE = {slug: page for slug, _, _, page in FERMA_MENU}
PAGE_TO_SLUG = {page: slug for slug, _, _, page in FERMA_MENU}

DEFAULT_PAGE = "대시보드"


def sync_nav_from_query() -> None:
    """Apply ``?nav=slug`` query param to session state."""
    raw = st.query_params.get("nav")
    slug = raw[0] if isinstance(raw, list) else raw
    if slug and slug in SLUG_TO_PAGE:
        st.session_state["ferma_nav"] = SLUG_TO_PAGE[slug]


def current_nav_page() -> str:
    sync_nav_from_query()
    return st.session_state.get("ferma_nav", DEFAULT_PAGE)


def _set_nav_page(page_key: str) -> None:
    st.session_state["ferma_nav"] = page_key
    slug = PAGE_TO_SLUG.get(page_key, "dash")
    st.query_params["nav"] = slug


def _on_nav_select(page_key: str) -> None:
    st.session_state["ferma_nav"] = page_key


def render_nav_html(active_page: str) -> str:
    """Nav brand chrome only — menu uses ``st.button`` (no ``<a href>``)."""
    _ = active_page
    return (
        '<nav class="ferma-app-nav" aria-label="메인 메뉴">'
        '<div class="ferma-nav-brand">'
        '<div class="ferma-nav-logo">Σ</div>'
        '<div><div class="ferma-nav-title">Math Management</div>'
        '<div class="ferma-nav-sub">Academy Management</div></div>'
        "</div>"
        "</nav>"
    )


def _render_nav_menu_buttons(active_page: str) -> None:
    st.markdown(
        '<div class="ferma-nav-section-label">메뉴</div>', unsafe_allow_html=True
    )
    st.markdown('<div class="ferma-nav-links">', unsafe_allow_html=True)
    for slug, icon, label, page_key in FERMA_MENU:
        is_active = page_key == active_page
        active_cls = "active" if is_active else ""
        st.markdown(
            f'<div class="ferma-nav-link-stack">'
            f'<div class="ferma-nav-link{active_cls}">'
            f'<span class="ferma-nav-icon">{icon}</span>'
            f'<span class="ferma-nav-label">{html_module.escape(label)}</span>'
            f"</div></div>",
            unsafe_allow_html=True,
        )
        st.button(
            label,
            key=f"nav_{slug}",
            on_click=_on_nav_select,
            args=(page_key,),
            type="primary" if is_active else "secondary",
            use_container_width=True,
        )
    st.markdown("</div>", unsafe_allow_html=True)


def render_fixed_nav_rail(
    *,
    teacher_selectbox_fn,
    teacher_admin_fn,
    footer_stats_fn,
) -> str:
    """
    Render fixed left rail (HTML nav + teacher widgets).
    ``teacher_*_fn`` receive no args and render Streamlit widgets.
    Returns active page key.
    """
    active = current_nav_page()
    st.markdown(render_nav_html(active), unsafe_allow_html=True)
    _render_nav_menu_buttons(active)

    with st.container():
        st.markdown('<div class="ferma-nav-rail-widgets">', unsafe_allow_html=True)
        st.markdown(
            '<div class="ferma-nav-section-label">강사</div>', unsafe_allow_html=True
        )
        teacher_selectbox_fn()
        with st.expander("강사 추가 / 관리", expanded=False):
            teacher_admin_fn()
        st.markdown('<div class="ferma-nav-footer">', unsafe_allow_html=True)
        footer_stats_fn()
        st.markdown("</div></div>", unsafe_allow_html=True)

    return active


def ferma_button(
    label: str,
    *,
    key: str,
    variant: str = "primary",
    use_container_width: bool = True,
) -> bool:
    """
    Custom HTML-styled button (Streamlit state via visually hidden native button).
    variant: ``primary`` | ``secondary`` | ``ghost``
    """
    host_id = html_module.escape(key.replace(" ", "_"))
    st.markdown(
        f'<div class="ferma-btn-stack">'
        f'<div class="ferma-btn-host ferma-btn-{variant}" data-ferma-btn="{host_id}">'
        f'<span class="ferma-btn-face">{html_module.escape(label)}</span>'
        f"</div></div>",
        unsafe_allow_html=True,
    )
    return st.button(
        label,
        key=f"_ferma_native_{key}",
        type="primary" if variant == "primary" else "secondary",
        use_container_width=use_container_width,
    )


@contextmanager
def ferma_main_card() -> Iterator[None]:
    """Deprecated: Streamlit widgets cannot be wrapped by HTML divs. No-op."""
    yield


@contextmanager
def ferma_card(title: str = "") -> Iterator[None]:
    """Nested content card inside main area."""
    if title:
        st.markdown(
            f'<div class="ferma-card"><div class="ferma-card-title">'
            f"{html_module.escape(title)}</div>",
            unsafe_allow_html=True,
        )
    else:
        st.markdown('<div class="ferma-card">', unsafe_allow_html=True)
    try:
        yield
    finally:
        st.markdown("</div>", unsafe_allow_html=True)
