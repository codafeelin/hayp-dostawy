# HAYP Dostawy – instrukcja

Aplikacja (PWA) na Androida: adres dostawy → trasa z restauracji i z powrotem → km w jedną i w obie strony → koszt paliwa → dane klienta → zapis w historii i wysyłka kierowcy.

## 1. Klucz API (5 min, za darmo)

Strona openrouteservice.org jest obecnie niedostępna (awaria PHP), a rejestracja przeniosła się do HeiGIT.

1. Wejdź na https://account.heigit.org/signup → wypełnij formularz (1 konto i 1 darmowy klucz na osobę) → **Register**. Można też **Signup with GitHub**.
2. Potwierdź e-mail, zaloguj się na https://account.heigit.org i skopiuj klucz z Dashboard (zaczyna się od `eyJ` – to normalne).
3. Limity planu Standard na dobę (https://account.heigit.org/info/plans): 2000 tras (40/min), 3000 wyszukiwań adresu (100/min). Jedna dostawa zużywa 1 trasę i kilka wyszukiwań – wystarcza na ponad 100 dostaw dziennie. Limit liczy się 24 h od pierwszego zapytania.
4. Apka (od v1.0.1) używa nowego adresu `api.heigit.org`. Stary `api.openrouteservice.org` ma od 27.08.2026 tylko 10% limitu i zostanie wyłączony w listopadzie 2026.

## 2. Wrzucenie na GitHub Pages (10 min, za darmo)

1. Załóż konto na https://github.com (jeśli nie masz).
2. **New repository** → nazwa np. `hayp-dostawy` → **Public** (darmowe Pages działają z publicznym repo; w plikach nie ma żadnego klucza ani danych klientów) → **Create repository**.
3. **Add file → Upload files** → zaznacz **wszystkie pliki z rozpakowanego ZIP** (są w jednym folderze, bez podfolderów – da się to zrobić także z telefonu) → **Commit changes**.
4. **Settings → Pages** → *Source*: **Deploy from a branch** → *Branch*: **main**, folder **/ (root)** → **Save**.
5. Po 1–2 min apka jest pod adresem `https://TWOJA-NAZWA.github.io/hayp-dostawy/`.

## 3. Instalacja na telefonie

1. Otwórz link w **Chrome** na Androidzie.
2. Kliknij **Zainstaluj** u góry apki albo menu **⋮ → Dodaj do ekranu głównego / Zainstaluj aplikację**.
3. Pierwsze uruchomienie: **Ustawienia** → wklej klucz → **Znajdź adres** (sprawdza klucz i ustala punkt startu) → **Zapisz ustawienia**.
4. Opcjonalnie: stojąc w lokalu kliknij **Ustaw z GPS** – start trasy będzie dokładnie przy drzwiach.

## 4. Jak działa

- **Adres**: wpisz ulicę i numer → wybierz z podpowiedzi (pokazuje miejscowość i odległość w linii prostej – ważne, bo np. „Leśna 5” jest w wielu wsiach). Lupa = pełne wyszukiwanie.
- **Trasa**: liczona osobno tam i z powrotem (powrót bywa inny przez ulice jednokierunkowe). Bez korków – to dystans drogowy z OpenStreetMap.
- **Koszt paliwa** = km × spalanie (l/100 km) ÷ 100 × cena (zł/l). Domyślnie Pb95 6,97 zł/l (średnia e-petrol z 14.10.2026) i 7 l/100 km. Zmienisz w Ustawieniach.
- **Brak adresu w bazie / brak internetu**: „Wpisz km ręcznie”.
- **Po zapisie**: Wyślij kierowcy (menu udostępniania), SMS, WhatsApp, Nawiguj (Google Maps), Zadzwoń do klienta, Oznacz jako dostarczone.
- **Historia**: Dziś / Wczoraj / 7 dni / Wszystko, sumy km i paliwa, eksport CSV do Excela (rozliczenie kierowcy).

## 5. Dane klientów (RODO)

- Imię, telefon, nr zamówienia i komentarz zapisują się **tylko w pamięci tego telefonu** (localStorage). Nie ma serwera ani bazy online.
- Do openrouteservice (HeiGIT gGmbH, Heidelberg, UE) trafia tylko wpisywany adres i współrzędne – bez imienia i telefonu.
- Klucz API jest zapisany tylko w telefonie (nie ma go w plikach na GitHubie). HeiGIT zaleca nie używać klucza po stronie przeglądarki – przy jednym telefonie w lokalu ryzyko jest małe; nie udostępniaj klucza innym.
- Historia usuwa się automatycznie po 7/14/30/90 dniach (domyślnie 30) + przycisk „Usuń całą historię”.
- Wyczyszczenie danych przeglądarki/apki na telefonie usuwa historię – przed tym zrób eksport CSV.

## 6. Aktualizacja apki

Po zmianie któregokolwiek pliku podbij numer w pierwszej linii `sw.js` (np. z `hayp-dostawy-v1.0.1` na `hayp-dostawy-v1.0.2`) i wrzuć pliki ponownie na GitHub. Telefon pobierze nową wersję przy następnym uruchomieniu (czasem po dwóch).

## Pliki

| Plik | Do czego |
|---|---|
| index.html | Ekrany apki |
| styles.css | Wygląd (neon na czarnym) |
| app.js | Logika: adresy, trasy, koszty, historia, wysyłka |
| sw.js | Działanie offline i instalacja |
| manifest.webmanifest | Nazwa, ikona, tryb pełnoekranowy |
| leaflet.js, leaflet.css | Mapa (Leaflet 1.9.4, licencja BSD-2) |
| icon-*.png, apple-touch-icon.png | Ikony (do podmiany na oficjalne logo HAYP) |

© openrouteservice by HeiGIT | Data from OpenStreetMap (ODbL) – podpis wymagany przez regulamin HeiGIT: https://account.heigit.org/info/tos
