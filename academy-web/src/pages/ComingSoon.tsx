import styles from './ComingSoon.module.css';

interface ComingSoonProps {
  title: string;
}

/**
 * 아직 React로 전환되지 않은 teacher 메뉴용 임시 화면.
 * 사이드바 라우팅은 이미 연결돼 있으니, 이 화면 자리에
 * 실제 기능이 완성되면 이 컴포넌트만 교체하면 됨.
 */
export function ComingSoon({ title }: ComingSoonProps) {
  return (
    <div className={styles.wrap}>
      <span className={styles.badge}>준비 중</span>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.desc}>이 화면은 아직 만드는 중이에요. 곧 이 자리에 실제 기능이 들어올 예정입니다.</p>
    </div>
  );
}
