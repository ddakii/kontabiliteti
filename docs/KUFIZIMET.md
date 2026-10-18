# Kufizimet dhe verifikimi ligjor

Kontabiliteti Pro është program kontabiliteti. Nuk është certifikim fiskal. Moduli i fiskalizimit flet protokollin publik të shembullit ATK për kuponin POS, por programi nuk është i certifikuar dhe nuk e shënon një faturë të fiskalizuar pa numër transaksioni të kthyer. Nuk e shënon një deklaratë tatimore si të dorëzuar nëse një proces i verifikuar nuk e konfirmon atë.

## TVSH dhe tatimet

Shabllonet `TVSH18` dhe `TVSH8` citojnë Ligjin Nr. 05/L-037 për Tatimin mbi Vlerën e Shtuar si referencë historike. Ato krijohen të pakonfirmuara. Kontabilisti duhet t’i krahasojë me tekstin aktual të Gazetës Zyrtare dhe me udhëzimet e ATK-së, pastaj t’i konfirmojë vetë. Konfirmimi është dëshmi e përdoruesit, jo verifikim i programit.

Statuset e raportit tatimor janë:

- draft i brendshëm;
- i shqyrtuar nga kontabilisti;
- i shënuar si i dorëzuar jashtë programit, vetëm me shënimin e përdoruesit.

## Pagat

Motori zbaton përqindjet, bazën dhe shkallët që ruhen për kompaninë. Nuk ka norma aktive të paracaktuara si ligj aktual. Llogaritja refuzohet derisa kontabilisti të konfirmojë setin e rregullave dhe burimin. Testet automatike përdorin vektorë të shpikur për të kontrolluar formulën, jo për të deklaruar norma të Kosovës.

## Pagesat e abonimit

Nuk ka ofrues pagese të lidhur. Nuk supozohet që një ofrues i caktuar është i disponueshëm për një biznes të regjistruar në Kosovë. Administratori aktivizon abonimin manualisht dhe regjistron pagesën vetëm me referencë dhe konfirmim.

## Fiskalizimi

Detajet, çelësi privat dhe kushtet që mbeten para produksionit janë te `docs/FISKALIZIMI.md`. Testet automatike përdorin përgjigje të simuluara. Nuk është kryer dërgim te mjedisi test i ATK-së gjatë ndërtimit.

## Lista mujore

Pikat e muajit kontabël janë kontroll operacional i zyrës. Shënimi i një pike si e përfunduar nuk e mbyll periudhën fiskale dhe nuk e shënon një detyrim tatimor si të dorëzuar.

## Banka dhe OCR

Llogaritë bankare nuk janë të lidhura automatikisht. Importi i ekstraktit është manual. OCR nuk ka ofrues të konfiguruar; rezultatet e ardhshme duhet të mbeten të paverifikuara derisa të shqyrtohen.

## Ndarja e të dhënave

Çdo pyetje e të dhënave të kompanisë filtron `firmId` dhe, kur duhet, `companyId` të zgjidhur në server. Identifikuesi që vjen nga shfletuesi nuk mjafton. Testet provojnë që një zyrë nuk lexon faturën, PDF-në ose kompaninë e një zyre tjetër.

Politikë shtesë e sigurisë në nivel rreshti të PostgreSQL mund të shtohet kur aplikacioni përdor një rol që nuk është pronar i tabelave dhe çdo transaksion vendos `app.firm_id`. Nuk është e detyruar në zhvillim, sepse pronari i tabelave e anashkalon atë politikë dhe sesionet e përbashkëta e bëjnë të rrezikshme nëse vendoset jashtë transaksionit.
