/*
 * A real library (work item N8): sqlite 3, statically linked, in memory: a table of 2000 rows, an
 * index, aggregates, ordering and printf. sqlite formats numbers with long double, so it needs x87.
 * Needs libsqlite3.a.
 */
#include <stdio.h>
#include <sqlite3.h>
static int row(void *u, int n, char **v, char **c) { (void)u; for (int i = 0; i < n; i++) printf("%s=%s ", c[i], v[i] ? v[i] : "NULL"); printf("\n"); return 0; }
int main(void) {
  sqlite3 *db; char *err = 0;
  if (sqlite3_open(":memory:", &db)) { printf("open failed\n"); return 1; }
  const char *sql =
    "create table t(id integer primary key, name text, score real);"
    "with recursive n(i) as (select 1 union all select i+1 from n where i < 2000) insert into t(name, score) select 'item' || i, (i * 37 % 1000) / 10.0 from n;"
    "create index s on t(score);"
    "select count(*), sum(score), avg(score), max(name) from t;"
    "select name, score from t where score > 99.5 order by score desc, name limit 5;"
    "select printf('%.3f', stddev) from (select sqrt(avg(score*score) - avg(score)*avg(score)) as stddev from t);";
  if (sqlite3_exec(db, sql, row, 0, &err) != SQLITE_OK) { printf("error: %s\n", err); return 1; }
  printf("sqlite %s\n", sqlite3_libversion());
  sqlite3_close(db);
  return 0;
}
