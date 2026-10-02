// Ephemeral localhost TLS for browser image decoding tests. Generate the key
// when the test runs; no private key or certificate is published in the repo.
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
export async function emailTestTls(){
 if(process.platform==='win32'){
  const script=`$testKey=[System.Security.Cryptography.RSA]::Create(2048)
$request=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost',$testKey,[System.Security.Cryptography.HashAlgorithmName]::SHA256,[System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$san=[System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName('localhost')
$san.AddIpAddress([System.Net.IPAddress]::Loopback)
$request.CertificateExtensions.Add($san.Build())
$cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),[DateTimeOffset]::UtcNow.AddDays(1))
@{key=$testKey.ExportPkcs8PrivateKeyPem();cert=$cert.ExportCertificatePem()} | ConvertTo-Json -Compress
$cert.Dispose()
$testKey.Dispose()`;
  return JSON.parse(execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:15000}));
 }
 const parent=resolve(tmpdir()),dir=await mkdtemp(join(parent,'academy-email-tls-'));
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore',timeout:15000});
  return {key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))};
 }finally{if(!resolve(dir).startsWith(parent+sep)||!dir.includes('academy-email-tls-'))throw Error('Unexpected TLS fixture directory');await rm(dir,{recursive:true,force:true});}
}
