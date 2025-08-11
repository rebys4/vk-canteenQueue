import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import '@vkontakte/vkui/dist/vkui.css';
import { AdaptivityProvider, AppRoot, ConfigProvider, SplitCol, SplitLayout } from '@vkontakte/vkui';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <ConfigProvider>
        <AdaptivityProvider>
            <AppRoot>
                <SplitLayout>
                    <SplitCol>
                        <App />
                    </SplitCol>
                </SplitLayout>
            </AppRoot>
        </AdaptivityProvider>
    </ConfigProvider>
);
