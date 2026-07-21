import { useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { api, ApiError, type Me } from './api/client';
import EditorPage from './pages/EditorPage';
import LoginPage from './components/LoginPage';

type AuthState = { status: 'loading' } | { status: 'anon' } | { status: 'authed'; user: Me };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    api
      .me()
      .then((user) => setAuth({ status: 'authed', user }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          setAuth({ status: 'anon' });
        } else {
          // 网络 / 服务端异常也落到登录页，避免白屏
          setAuth({ status: 'anon' });
        }
      });
  }, []);

  if (auth.status === 'loading') {
    return (
      <div className="boot-screen">
        <span className="boot-spinner" />
        加载中…
      </div>
    );
  }
  if (auth.status === 'anon') {
    return <LoginPage />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<EditorPage user={auth.user} />} />
        <Route path="*" element={<EditorPage user={auth.user} />} />
      </Routes>
    </HashRouter>
  );
}
