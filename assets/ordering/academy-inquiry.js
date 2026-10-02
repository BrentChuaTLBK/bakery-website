// Preserve workshop context in the existing contact form without submitting it
// or changing the destination/recipient chosen by the business.
const params=new URLSearchParams(location.search);
const workshop=(params.get('academy_workshop')||(params.has('academy_class')?params.get('title'):'')||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160);
if(workshop){
 const form=document.querySelector('form[data-bss-recipient]'),subject=form?.elements.namedItem('Subject'),message=form?.elements.namedItem('message');
 if(subject&&!subject.value)subject.value='Academy workshop: '+workshop;
 if(message&&!message.value)message.value=`Hello! I would like to ask about the ${workshop} workshop.\n\n`;
 if(form){
  const context=document.createElement('div');context.className='mb-3';context.setAttribute('role','note');
  const title=document.createElement('p');title.textContent='Asking about: '+workshop;
  const back=document.createElement('a');back.href='/academy/dashboard#upcoming';back.textContent='← Back to Academy workshops';
  context.append(title,back);form.prepend(context);
 }
}
