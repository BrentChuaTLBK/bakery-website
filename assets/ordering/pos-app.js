// An online shortcut only: no service worker, response cache or offline queue.
let installPrompt;
export function posAppMarkup(){return `<div class="pos-app-tools"><p id="pos-connection" role="status"></p><button type="button" class="button button-secondary" data-pos-install hidden>Install POS</button><details><summary>Add POS to your home screen</summary><p>On iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen. On Android or desktop, use your browser's Install app or Add to Home Screen option. Sign in with your usual staff account. Internet is required for sales.</p></details></div>`}
export function refreshPOSConnection(){
 const status=document.querySelector('#pos-connection');
 if(status){status.textContent=navigator.onLine?'Connection: online':'You are offline. Reconnect before recording a sale or payment. Nothing is sent automatically.';status.classList.toggle('notice',!navigator.onLine)}
 const button=document.querySelector('[data-pos-install]');if(button){button.hidden=!installPrompt;button.onclick=async()=>{const prompt=installPrompt;installPrompt=null;refreshPOSConnection();if(prompt)await prompt.prompt()}}
}
window.addEventListener('online',refreshPOSConnection);window.addEventListener('offline',refreshPOSConnection);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;refreshPOSConnection()});
window.addEventListener('appinstalled',()=>{installPrompt=null;refreshPOSConnection()});
