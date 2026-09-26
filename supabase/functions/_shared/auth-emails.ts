import {emailLayout,emailButton,emailPanel,paragraph} from './email-layout.ts';

// Supabase's own template variables remain intact. Never replace its generated
// confirmation URL with a guessed token, redirect or login endpoint.
export const authEmails:Record<string,{title:string;message:string;button?:string;notice:string;code?:boolean}>={
 confirmation:{title:'Welcome to our kitchen!',message:'Confirm your email address to finish creating your TLB Kitchen account.',button:'Confirm email address',notice:'If you didn’t create this account, you can ignore this email.'},
 recovery:{title:'Let’s reset your password',message:'We received a request to reset your TLB Kitchen password. Use the secure link below to choose a new one.',button:'Reset my password',notice:'If you didn’t request a reset, you can ignore this email. Your password will stay the same.'},
 magic_link:{title:'Your sign-in link is ready',message:'Use the secure link below to sign in to your TLB Kitchen account.',button:'Sign in to my account',notice:'This link can only be used once. If you didn’t request it, you can ignore this email.'},
 invite:{title:'You’re invited to our kitchen',message:'You’ve been invited to create a TLB Kitchen account. Accept your invitation to get started.',button:'Accept invitation',notice:'If you weren’t expecting this invitation, you can ignore this email.'},
 email_change:{title:'Confirm your email change',message:'Confirm the requested change to {{ .NewEmail }} for your TLB Kitchen account.',button:'Confirm email change',notice:'If you didn’t request this change, do not confirm it. Contact us for help.'},
 reauthentication:{title:'Your verification code',message:'Enter this code in your TLB Kitchen account to confirm it’s you.',code:true,notice:'Keep this code private. If you didn’t request it, do not share or use it.'},
 password_changed_notification:{title:'Your password was changed',message:'The password for your TLB Kitchen account was changed.',notice:'If you didn’t make this change, reset your password and contact us immediately.'},
 email_changed_notification:{title:'Your email address was changed',message:'Your account email was changed from {{ .OldEmail }} to {{ .Email }}.',notice:'If you didn’t make this change, contact us immediately.'},
 phone_changed_notification:{title:'Your phone number was changed',message:'Your account phone number was changed from {{ .OldPhone }} to {{ .Phone }}.',notice:'If you didn’t make this change, contact us immediately.'},
 identity_linked_notification:{title:'A sign-in method was added',message:'A {{ .Provider }} sign-in method was linked to your TLB Kitchen account.',notice:'If you didn’t make this change, contact us immediately.'},
 identity_unlinked_notification:{title:'A sign-in method was removed',message:'A {{ .Provider }} sign-in method was removed from your TLB Kitchen account.',notice:'If you didn’t make this change, contact us immediately.'},
 mfa_factor_enrolled_notification:{title:'A verification method was added',message:'A {{ .FactorType }} verification method was added to your TLB Kitchen account.',notice:'If you didn’t make this change, contact us immediately.'},
 mfa_factor_unenrolled_notification:{title:'A verification method was removed',message:'A {{ .FactorType }} verification method was removed from your TLB Kitchen account.',notice:'If you didn’t make this change, contact us immediately.'},
};
export function renderAuthEmail(name:string):string {
 const c=authEmails[name];if(!c)throw Error('Unknown account email');
 return emailLayout({title:c.title,preview:c.message.replace(/{{.*?}}/g,'your account'),kicker:'Your TLB account',body:paragraph(c.message)+(c.code?emailPanel('<p style="font:bold 32px/1.4 Courier New,monospace;letter-spacing:6px;margin:0">{{ .Token }}</p>','#f4ded2'):'')+(c.button?emailButton(c.button,'{{ .ConfirmationURL }}'):'')+`<div style="height:18px;line-height:18px">&nbsp;</div>`+paragraph(c.notice),footer:paragraph('A little help from our kitchen?')+'<a href="mailto:tlbk.kitchen@gmail.com" style="color:#764b25;text-decoration:underline">Contact The Little Baker Kitchen</a>'});
}
