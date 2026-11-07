(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = { token: sessionStorage.getItem('ledgerline_token') || '', email: sessionStorage.getItem('ledgerline_email') || '', accounts: [], transactions: [], pendingTransfer: null, authMode: 'login' };
  const money = (value, currency='USD') => {
    const n = Number(value || 0);
    try { return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:2}).format(n); }
    catch { return `${currency} ${n.toFixed(2)}`; }
  };
  const escapeHtml = (value='') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateText = value => value ? new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}) : '—';
  const shortId = value => value ? `${value.slice(0,8)}…${value.slice(-4)}` : '—';
  function toast(message, type='') {
    const el=document.createElement('div'); el.className=`toast ${type}`; el.textContent=message; $('#toast-region').append(el);
    setTimeout(()=>el.remove(),4200);
  }
  async function api(path, options={}) {
    const headers={'Content-Type':'application/json',...(options.headers||{})};
    if(state.token) headers.Authorization=`Bearer ${state.token}`;
    let response;
    try { response=await fetch(path,{...options,headers}); }
    catch { throw new Error('Cannot connect to LedgerLine. Check your internet connection and try again.'); }
    const body=await response.json().catch(()=>({}));
    if(!response.ok || body.success===false) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }
  function setBusy(button,busy,label) {
    if(!button) return;
    if(busy){button.dataset.original=button.innerHTML;button.disabled=true;button.textContent=label||'Please wait…';}
    else {button.disabled=false;if(button.dataset.original)button.innerHTML=button.dataset.original;}
  }
  function showAuth(mode='login') {
    state.authMode=mode;
    $('#auth-screen').classList.remove('hidden'); $('#app-shell').classList.add('hidden');
    $('#auth-title').textContent=mode==='login'?'Welcome back':'Create your account';
    $('#auth-subtitle').textContent=mode==='login'?'Sign in to continue to your dashboard.':'Set up your secure LedgerLine workspace.';
    $('#auth-submit').innerHTML=mode==='login'?'Sign in <span>→</span>':'Create account <span>→</span>';
    $('#auth-password').autocomplete=mode==='login'?'current-password':'new-password';
    $$('.auth-tab').forEach(b=>b.classList.toggle('active',b.dataset.authMode===mode));
  }
  function showApp() {
    $('#auth-screen').classList.add('hidden'); $('#app-shell').classList.remove('hidden');
    $('#user-email').textContent=state.email; $('#user-avatar').textContent=(state.email[0]||'U').toUpperCase();
    $('#today-date').textContent=new Date().toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    navigate('dashboard');
  }
  function navigate(view) {
    const valid=['dashboard','accounts','transfers','transactions','audit'];
    if(!valid.includes(view)) view='dashboard';
    $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));
    $$('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    const label={dashboard:'Overview',accounts:'Accounts',transfers:'Transfers',transactions:'Transactions',audit:'Audit trail'}[view];
    $('#breadcrumb-current').textContent=label;
    $('#sidebar').classList.remove('open');
    if(view==='dashboard') loadDashboard();
    if(view==='accounts') loadAccounts();
    if(view==='transfers') loadTransferAccounts();
    if(view==='transactions') loadTransactions();
    if(view==='audit') loadAudit();
  }
  function accountIcon(name='') {
    const n=name.toLowerCase();
    return n.includes('saving')?'◈':n.includes('business')?'▦':'▤';
  }
  async function loadAccounts() {
    const box=$('#accounts-list'); box.innerHTML='<div class="empty-state">Loading accounts…</div>';
    try {
      const result=await api('/accounts'); state.accounts=result.data||[];
      renderAccounts(); populateTransferAccounts();
    } catch(e) { box.innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`; }
  }
  function renderAccounts() {
    const active=state.accounts.filter(a=>a.is_active);
    $('#account-count').textContent=`${active.length} account${active.length===1?'':'s'}`;
    $('#accounts-caption').textContent=`${active.length} active · ${state.accounts.length-active.length} closed`;
    $('#accounts-list').innerHTML=active.length?active.map(a=>`
      <article class="account-card">
        <div class="account-card-top"><span class="account-icon">${accountIcon(a.name)}</span><span class="active-label">● Active</span></div>
        <h4>${escapeHtml(a.name)}</h4><div class="subline">${escapeHtml(a.currency)} · ${escapeHtml(shortId(a.id))}</div>
        <div class="balance">${money(a.balance,a.currency)}</div>
        <div class="account-card-actions"><small>Created ${dateText(a.created_at)}</small><span><button class="text-button" data-copy-account="${escapeHtml(a.id)}">Copy ID</button><button class="danger-link" data-close-account="${escapeHtml(a.id)}">Close</button></span></div>
      </article>`).join(''):'<div class="empty-state">No accounts yet. Create your first account to get started.</div>';
    $('#dashboard-accounts').innerHTML=active.length?active.slice(0,4).map(a=>`
      <div class="account-row"><span class="account-icon">${accountIcon(a.name)}</span><div class="account-info"><strong>${escapeHtml(a.name)}</strong><small>${escapeHtml(a.currency)} · ${escapeHtml(shortId(a.id))}</small></div><span class="account-balance">${money(a.balance,a.currency)}</span></div>`).join(''):'<div class="empty-state">No accounts yet. Add an account to see it here.</div>';
  }
  function populateTransferAccounts() {
    const select=$('#transfer-from'); const active=state.accounts.filter(a=>a.is_active);
    select.innerHTML='<option value="">Choose source account</option>'+active.map(a=>`<option value="${escapeHtml(a.id)}" data-currency="${escapeHtml(a.currency)}">${escapeHtml(a.name)} — ${money(a.balance,a.currency)}</option>`).join('');
  }
  async function loadTransferAccounts() {
    if(!state.accounts.length) await loadAccounts();
    populateTransferAccounts();
  }
  async function loadTransactions() {
    const body=$('#transactions-body'); body.innerHTML='<tr><td colspan="5" class="empty-state">Loading transactions…</td></tr>';
    try {
      const result=await api('/transactions?limit=100&offset=0'); state.transactions=result.data||[];
      renderTransactions();
    } catch(e) { body.innerHTML=`<tr><td colspan="5" class="empty-state">${escapeHtml(e.message)}</td></tr>`; }
  }
  function renderTransactions() {
    const list=state.transactions;
    $('#transaction-count').textContent=`${list.length} records`;
    $('#total-transactions').textContent=list.length;
    const rows=list.map(t=>`<tr><td>${escapeHtml(shortId(t.id))}</td><td>${escapeHtml(t.description||'Account transfer')}</td><td class="amount-cell">${money(t.amount,t.currency)}</td><td><span class="status-tag">${escapeHtml(t.status||'unknown')}</span></td><td>${dateText(t.created_at)}</td></tr>`).join('');
    $('#transactions-body').innerHTML=rows||'<tr><td colspan="5" class="empty-state">No transactions recorded yet.</td></tr>';
    $('#dashboard-transactions').innerHTML=list.slice(0,5).map(t=>`
      <div class="activity-row"><span class="activity-icon">⇄</span><div class="activity-info"><strong>${escapeHtml(t.description||'Account transfer')}</strong><small>${dateText(t.created_at)} · ${escapeHtml(t.status)}</small></div><span class="activity-amount">${money(t.amount,t.currency)}</span></div>`).join('')||'<div class="empty-state">No recent activity.</div>';
  }
  async function loadDashboard() {
    try {
      const [accountsResult,transactionsResult]=await Promise.all([api('/accounts'),api('/transactions?limit=100&offset=0')]);
      state.accounts=accountsResult.data||[]; state.transactions=transactionsResult.data||[];
      const active=state.accounts.filter(a=>a.is_active);
      const currencies=[...new Set(active.map(a=>a.currency))];
      const total=currencies.length===1?active.reduce((sum,a)=>sum+Number(a.balance||0),0):null;
      $('#total-balance').textContent=total===null?(currencies.length?'Multiple currencies':'—'):money(total,currencies[0]||'USD');
      $('#total-accounts').textContent=active.length;
      renderAccounts(); renderTransactions(); populateTransferAccounts();
    } catch(e) { toast(e.message,'error'); }
  }
  async function loadAudit() {
    const box=$('#audit-list'); box.innerHTML='<div class="empty-state">Loading audit events…</div>';
    try {
      const result=await api('/audit?limit=100&offset=0'); const events=result.data||[];
      $('#audit-count').textContent=`${events.length} events`;
      box.innerHTML=events.map(ev=>`<div class="audit-row"><span class="audit-bullet">⌁</span><div class="audit-detail"><strong>${escapeHtml(ev.event_type||'Event')}</strong><p>${escapeHtml(ev.resource_type||'resource')} ${ev.resource_id?'· '+escapeHtml(shortId(ev.resource_id)):''}</p></div><time class="audit-time">${dateText(ev.created_at)}</time></div>`).join('')||'<div class="empty-state">No audit events found.</div>';
    } catch(e) { box.innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`; }
  }
  async function closeAccount(id) {
    if(!confirm('Close this account? Only accounts with a zero balance can be closed.')) return;
    try { await api(`/accounts/${encodeURIComponent(id)}`,{method:'DELETE'});toast('Account closed successfully.','success');await loadAccounts(); }
    catch(e){toast(e.message,'error');}
  }
  async function submitTransfer() {
    const data=state.pendingTransfer;if(!data)return;
    const button=$('#confirm-transfer');setBusy(button,true,'Processing…');
    try {
      const result=await api('/transfers',{method:'POST',headers:{'Idempotency-Key':data.key},body:JSON.stringify(data.payload)});
      $('#confirm-dialog').close();
      toast(`Transfer completed · ID ${shortId(result.data.transactionId)}`,'success');
      state.pendingTransfer=null;$('#transfer-form').reset();await loadDashboard();navigate('transactions');
    } catch(e){toast(e.message,'error');}
    finally{setBusy(button,false);}
  }
  $('#auth-form').addEventListener('submit',async e=>{
    e.preventDefault();const button=$('#auth-submit');setBusy(button,true,'Please wait…');
    const mode=state.authMode;const email=$('#auth-email').value.trim().toLowerCase();const password=$('#auth-password').value;
    try {
      const result=await api(mode==='login'?'/auth/login':'/auth/register',{method:'POST',body:JSON.stringify({email,password})});
      state.token=result.data.token;state.email=result.data.email;
      sessionStorage.setItem('ledgerline_token',state.token);sessionStorage.setItem('ledgerline_email',state.email);
      $('#auth-password').value='';showApp();toast(mode==='login'?'Welcome back.':'Your LedgerLine account is ready.','success');
    } catch(err){toast(err.message,'error');}
    finally{setBusy(button,false);}
  });
  $$('.auth-tab').forEach(b=>b.addEventListener('click',()=>showAuth(b.dataset.authMode)));
  document.addEventListener('click',e=>{
    const view=e.target.closest('[data-view]');if(view){e.preventDefault();navigate(view.dataset.view);}
    const copy=e.target.closest('[data-copy-account]');if(copy){navigator.clipboard?.writeText(copy.dataset.copyAccount).then(()=>toast('Account ID copied.','success')).catch(()=>toast('Could not copy automatically.','error'));}
    const close=e.target.closest('[data-close-account]');if(close)closeAccount(close.dataset.closeAccount);
  });
  $('#logout-button').addEventListener('click',()=>{state.token='';state.email='';sessionStorage.removeItem('ledgerline_token');sessionStorage.removeItem('ledgerline_email');state.accounts=[];state.transactions=[];showAuth('login');toast('You have signed out.');});
  $('#menu-toggle').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#show-account-form').addEventListener('click',()=>$('#account-form-wrap').classList.remove('hidden'));
  $('#hide-account-form').addEventListener('click',()=>$('#account-form-wrap').classList.add('hidden'));
  $('#account-form').addEventListener('submit',async e=>{
    e.preventDefault();const button=e.submitter;setBusy(button,true,'Creating…');
    try {
      await api('/accounts',{method:'POST',body:JSON.stringify({name:$('#account-name').value.trim(),currency:$('#account-currency').value,initialBalance:Number($('#account-balance').value)})});
      $('#account-form').reset();$('#account-balance').value='0';$('#account-form-wrap').classList.add('hidden');toast('Account created.','success');await loadAccounts();
    } catch(err){toast(err.message,'error');}
    finally{setBusy(button,false);}
  });
  $('#transfer-from').addEventListener('change',e=>{
    const option=e.target.selectedOptions[0];if(option?.dataset.currency)$('#transfer-currency').value=option.dataset.currency;
  });
  $('#transfer-form').addEventListener('submit',e=>{
    e.preventDefault();
    const payload={from_account_id:$('#transfer-from').value,to_account_id:$('#transfer-to').value.trim(),amount:$('#transfer-amount').value,currency:$('#transfer-currency').value,description:$('#transfer-description').value.trim()||undefined};
    if(!payload.from_account_id){toast('Choose a source account.','error');return;}
    if(payload.from_account_id===payload.to_account_id){toast('Source and destination accounts must be different.','error');return;}
    state.pendingTransfer={payload,key:window.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`};
    const source=state.accounts.find(a=>a.id===payload.from_account_id);
    $('#confirm-copy').textContent=`Transfer ${money(payload.amount,payload.currency)} from ${source?.name||'your account'} to destination ${shortId(payload.to_account_id)}. This action cannot be undone.`;
    $('#confirm-dialog').showModal();
  });
  $('#confirm-transfer').addEventListener('click',e=>{e.preventDefault();submitTransfer();});
  $('#refresh-transactions').addEventListener('click',loadTransactions);
  $('#verify-audit').addEventListener('click',async e=>{
    const button=e.currentTarget;setBusy(button,true,'Verifying…');
    try {const result=await api('/audit/verify');const data=result.data||{};const valid=Boolean(data.valid);const box=$('#audit-verification');box.className=`verification-result ${valid?'ok':'bad'}`;box.textContent=valid?'✓ Audit chain verified. No tampering detected.':`Integrity verification reported an issue: ${data.message||'Please review the audit chain.'}`;}
    catch(err){toast(err.message,'error');}
    finally{setBusy(button,false);}
  });
  if(state.token) showApp(); else showAuth('login');
})();