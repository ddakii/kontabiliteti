# Fiskalizimi ATK

Ky modul është pjesë e Kontabiliteti Pro KS. Nuk është aplikacion POS më vete dhe nuk e zëvendëson kontabilitetin.

Shembulli i përdorur është depoja publike [fiskalizimi/pos-csharp](https://github.com/fiskalizimi/pos-csharp). Prej saj janë marrë `models.proto`, radha e nënshkrimit në `Signer.cs` dhe `Program.cs`, subjektet e CSR në `Pki.cs`, dhe adresat e dokumentuara. Nuk janë kopjuar çelësa, NUI shembull ose kupona të gatshëm në të dhënat e produksionit.

## Çfarë bën

Kontabilisti, brenda kompanisë kliente, ruan NUI, numrin e fiskalizimit nga EDI, numrin e aplikacionit, degën dhe POS-in. Pastaj nis verifikimin dhe nënshkrimin e CSR. Kuponi ndërtohet nga fatura e ruajtur, serializohet me Protobuf, nënshkruhet dhe dërgohet te `POST /pos/coupon`.

Kuponi i qytetarit përdoret vetëm për vargun e kodit QR në kuponin e printuar. Nuk dërgohet te `/citizen/coupon`.

## Adresat

- Test: `https://fiskalizimi-test.atk-ks.org`
- Produksion: `https://fiskalizimi.atk-ks.org`
- `POST /ca/verify/{nui}`
- `POST /ca/signcsr`
- `POST /pos/coupon`
- Kontrolli i lidhjes lexon `GET /swagger/index.html` dhe nuk krijon kupon

Nuk ka endpoint të dokumentuar për leximin e statusit. Nëse përgjigjja humbet, kuponi mbetet `UNKNOWN` dhe nuk krijohet kupon i ri.

## Paratë

Çmimi i artikullit shkon në njësi €0.0001. Totalet, TVSH-ja dhe pagesa shkojnë në centë. Rrumbullakimi është gjysmë-lart me `decimal.js`. TVSH-ja mbetet ajo e faturës. Shkronjat A, C, D dhe E vijnë nga shembulli publik, jo nga një opinion ligjor. Një normë tjetër e bllokon dërgimin.

## Çelësi privat

Shembulli thotë që çdo POS ka çelësin e vet dhe ai nuk del nga makina ku u krijua. Këtu makina është serveri që e gjeneron çelësin. Çelësi ruhet i enkriptuar në diskun e atij serveri, nën `server/storage/fiscal-keys`, jo në PostgreSQL, jo në shfletues dhe jo në git. Baza ruan vetëm certifikatën publike, gjurmën dhe rrugën relative.

Nëse programi xhirohet në shumë serverë, nënshkrimi duhet të ndodhë në serverin ku u krijua çelësi. Ky modul nuk e ngarkon një çelës të krijuar në arkë. Nuk ofron API publik për nënshkrim të lirë.

Ndryshimi i NUI, i numrit të aplikacionit, i numrit të fiskalizimit ose i mjedisit e tërheq certifikatën nga përdorimi. Skedari i vjetër mbetet i riemërtuar në të njëjtin disk.

## Procedura zyrtare e certifikimit

Dokumenti i ATK-së “Kushtet dhe procedurat për aplikimin, certifikimin dhe mirëmbajtjen e softuerëve elektronikë fiskalë (SEF)”, i nënshkruar më 03.07.2026, zbatohet për zhvilluesin ose mirëmbajtësin e softuerit, jo për secilin tatimpagues veç e veç. Ai mbështetet në Udhëzimin Administrativ (MF) Nr. 01/2026 dhe në Ligjin Nr. 08/L-257.

Para se fiskalizimi t’u ofrohet tatimpaguesve, zhvilluesi duhet të aplikojë te Komisioni i ATK-së. Certifikimi është kusht për ushtrimin e ligjshëm të kësaj veprimtarie. Nëse kërkesa miratohet, ATK lëshon certifikatën dhe Numrin Identifikues të SEF-it. Ky numër është identifikuesi i softuerit që protokolli e kërkon si numër aplikacioni. Nuk vendoset nga Kontabiliteti Pro.

Kërkesa përfshin formularin e ATK-së, dokumentin e identifikimit ose certifikatën e ARBK-së, përshkrimin e softuerit dhe të mënyrës së lidhjes me ATK-në, manualin e përdoruesit dhe deklaratën e nënshkruar të pajtueshmërisë. Dokumentacioni i paplotë plotësohet brenda 7 ditëve pune, përndryshe kërkesa tërhiqet. Komisioni vendos brenda 15 ditëve pune nga pranimi. Testimi teknik përfshin sigurinë, saktësinë e kuponit, raportimin në kohë reale dhe dërgimin e përsëritur të transaksionit të ruajtur pasi kthehet lidhja.

Çdo ndryshim që prek gjenerimin, ruajtjen ose dërgimin e kuponit duhet t’i njoftohet ATK-së para se të vihet në përdorim. Certifikata mbetet e vlefshme derisa ATK ta pezullojë, ta tërheqë ose ta anulojë. Regjistri i softuerëve të certifikuar botohet në faqen e ATK-së.

Ky modul ende nuk është në atë regjistër. Kuponi i printuar ka kodin QR të protokollit publik vetëm pas një përgjigjeje të suksesshme. Logoja fiskale zyrtare nuk është në këtë dokument dhe nuk është vendosur në PDF. Ridërgimi automatik i të njëjtit kupon të ruajtur, pas rikthimit të lidhjes, nuk është ndërtuar. Rezultati i panjohur mbetet i shënuar dhe nuk krijohet kupon i ri.

## Çfarë mbetet para fiskalizimit të vërtetë

- Numri i aplikacionit, pasi ATK të certifikojë këtë program. Nuk është i dhënë këtu.
- NUI, numri i fiskalizimit nga EDI, dega dhe POS-i për secilin biznes.
- Vendimi nëse serveri i kontabilitetit pranohet si POS, apo çelësi duhet të rrijë në një arkë fizike.
- Shqyrtim ligjor i shkronjave të TVSH-së, i llojit të artikullit dhe i njësisë.
- Provë e autorizuar në mjedisin test të ATK-së. Ndërtimi aktual është provuar me përgjigje të simuluara, jo me ATK test ose produksion.
- Ky dokument nuk është certifikim, miratim ose deklaratë përputhshmërie.
