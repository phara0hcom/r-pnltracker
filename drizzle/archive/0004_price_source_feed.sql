-- The TradingView webhook publishes its close as the instrument's price.
--
-- The alert fires at the daily close, while the quote providers are polled only
-- when someone asks — so at that moment the bar is the freshest reading anyone
-- has, and Positions was showing a staler figure than the Exit Rules card
-- beside it. FEED distinguishes those rows from a fetched quote in Settings.
--
-- Appended rather than inserted: renumbering the enum would rewrite every
-- existing price_cache row's source.
ALTER TYPE "public"."price_source" ADD VALUE 'FEED';
