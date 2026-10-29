import json
import urllib.request
import urllib.error

BASE = 'http://127.0.0.1:5230/api'
def request(path, method='GET', data=None, token=None, expected=200):
    headers = {'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as res:
            status, content = res.status, res.read()
    except urllib.error.HTTPError as e:
        status, content = e.code, e.read()
    assert status == expected, (path, status, content)
    return json.loads(content) if content else None

for name in ('alice','bob','mallory'):
    request('/auth/register', 'POST', {'username':name,'displayName':name,'password':'long-password-123'})
tokens = {name: request('/auth/login', 'POST', {'username':name,'password':'long-password-123'})['token'] for name in ('alice','bob','mallory')}
a,b,m = (tokens[n] for n in ('alice','bob','mallory'))
chat = request('/chats', 'POST', {'username':'bob'}, a)['id']
assert request('/chats', 'POST', {'username':'alice'}, b)['id'] == chat
msg = request(f'/chats/{chat}/messages','POST',{'text':'hello'},a)['id']
assert request(f'/chats/{chat}/messages',token=b)[0]['text']=='hello'
request(f'/chats/{chat}/messages', token=m, expected=404)
request(f'/chats/{chat}/messages/{msg}', 'PUT', {'text':'hijack'}, b, expected=404)
request(f'/chats/{chat}/messages/{msg}', 'PUT', {'text':'edited'}, a)
assert request(f'/chats/{chat}/messages', token=b)[0]['text']=='edited'
request(f'/chats/{chat}/messages/{msg}', 'DELETE', token=a, expected=204)
assert request(f'/chats/{chat}/messages', token=b)==[]
bot = request('/bots','POST',{'username':'demo_bot','displayName':'Demo'},a)['token']
botchat = request('/chats','POST',{'username':'demo_bot'},b)['id']
request(f'/chats/{botchat}/messages','POST',{'text':'hi bot'},b)
updates = request('/bot/updates?offset=0',token=bot)
assert len(updates)==1 and updates[0]['chatId']==botchat
assert request('/bot/updates?offset='+str(updates[0]['updateId']),token=bot)==[]
request('/bot/messages','POST',{'chatId':chat,'text':'intrusion'},bot,expected=404)
request('/bot/messages','POST',{'chatId':botchat,'text':'hello'},bot)
assert request(f'/chats/{botchat}/messages',token=b)[-1]['text']=='hello'
request('/auth/logout','POST',token=b,expected=204)
request('/chats',token=b,expected=401)
print('API smoke test passed')
