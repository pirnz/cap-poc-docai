@cds.server.body_parser.limit: '50mb'
service CallbackEnrichService @(path: '/odata/v4/callback-enrich') {
  @open
  action callbackEnrich(payload: LargeString) returns String;
}
