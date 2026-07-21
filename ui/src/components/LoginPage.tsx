export default function LoginPage() {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🐢</div>
        <h1>小海龟画图</h1>
        <p>用 Logo 风格命令指挥小海龟作画，保存并分享你的作品。</p>
        <a className="btn btn-primary btn-lg" href="/api/auth/login">
          登录
        </a>
        <p className="login-hint">
          通过懒猫微服访问时若看到此页，请确认从懒猫应用入口进入。
        </p>
      </div>
    </div>
  );
}
