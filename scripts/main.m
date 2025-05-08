T = readtable('ciexyz31.csv');

plot(T.Var1, T.Var2);
hold on;
plot(T.Var1, T.Var3);
hold on;
plot(T.Var1, T.Var4);
hold on;