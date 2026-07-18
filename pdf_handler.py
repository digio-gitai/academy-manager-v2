import streamlit as st
import student_report_pdf


def run_pdf_generator(
    pdf_sid,
    sel_test_id,
):
    from app_layout import ferma_button

    if ferma_button("PDF 생성", key="dash_pdf_generate_btn", variant="primary"):
        try:
            pdf_bytes, pdf_fname = (
                student_report_pdf.generate_wrong_answer_note_pdf_from_db_weasyprint(
                    student_id=pdf_sid,
                    test_id=sel_test_id,
                    similar_questions=None,
                )
            )
            st.session_state["dash_pdf_bytes"] = pdf_bytes
            st.session_state["dash_pdf_fname"] = pdf_fname
            st.success("PDF 생성 완료!")
        except Exception as e:
            st.error(f"오답노트 생성 실패: {str(e)}")

    if st.session_state.get("dash_pdf_bytes") and st.session_state.get(
        "dash_pdf_fname"
    ):
        st.download_button(
            "PDF 다운로드",
            data=st.session_state["dash_pdf_bytes"],
            file_name=st.session_state["dash_pdf_fname"],
            mime="application/pdf",
        )
